import { useState, useRef, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useClubContext } from "@/lib/clubDetection";
import { useClubVolunteers } from "@/hooks/useOwner";
import { useAllVolunteersStatus, useCheckInVolunteer, useCheckOutVolunteer } from "@/hooks/useAttendance";
import { useToast } from "@/hooks/use-toast";
import { doc, getDoc, collectionGroup, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import * as faceapi from 'face-api.js';
import { loadFaceModels, FACE_DETECTOR_OPTS } from '@/lib/faceApi';

export default function VolunteerGrid() {
    const { club } = useClubContext();
    const { toast } = useToast();
    const { data: volunteers, isLoading } = useClubVolunteers();
    const { statusMap, loading: statusLoading } = useAllVolunteersStatus();
    const checkIn = useCheckInVolunteer();
    const checkOut = useCheckOutVolunteer();

    // Track volunteers who forgot to log out on past days
    const [forgotLogoutSet, setForgotLogoutSet] = useState<Set<string>>(new Set());
    useEffect(() => {
        if (!club?.id) return;
        const today = new Date().toISOString().slice(0, 10);
        // Query all volunteer attendance records that have no checkOutTime and are from before today
        const q = query(
            collectionGroup(db, "attendance"),
            where("clubId", "==", club.id),
            where("type", "==", "volunteer"),
            where("checkOutTime", "==", null),
        );
        getDocs(q).then((snap) => {
            const ids = new Set<string>();
            snap.docs.forEach((d) => {
                const data = d.data();
                if (data.date && data.date < today) {
                    ids.add(data.userId);
                }
            });
            setForgotLogoutSet(ids);
        }).catch(() => {});
    }, [club?.id]);

    const [verifyingVol, setVerifyingVol] = useState<any | null>(null);
    const [faceStatus, setFaceStatus] = useState('');
    const [modelsLoaded, setModelsLoaded] = useState(false);

    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const intervalRef = useRef<any>(null);
    // Keep a live ref to statusMap to avoid stale closures inside the interval
    const statusMapRef = useRef(statusMap);
    useEffect(() => { statusMapRef.current = statusMap; }, [statusMap]);

    // Load face-api models via the shared loader (cached app-wide)
    useEffect(() => {
        loadFaceModels().then(() => setModelsLoaded(true)).catch(() => {});
    }, []);

    const stopCamera = () => {
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
        if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    };

    const closeModal = () => {
        stopCamera();
        setVerifyingVol(null);
        setFaceStatus('');
    };

    const startVerification = async (vol: any) => {
        if (!modelsLoaded) { setFaceStatus('Face models still loading…'); return; }
        if (!vol.faceDescriptor) {
            setFaceStatus('Face not enrolled for this volunteer.');
            return;
        }

        setFaceStatus('Look at the camera…');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
            }
        } catch {
            setFaceStatus('Camera access denied.');
            return;
        }

        // Brief pause so the video feed stabilises
        await new Promise(r => setTimeout(r, 1500));
        let attempts = 0;

        intervalRef.current = setInterval(async () => {
            if (!videoRef.current) return;
            attempts++;
            try {
                const det = await faceapi
                    .detectSingleFace(videoRef.current, FACE_DETECTOR_OPTS)
                    .withFaceLandmarks()
                    .withFaceDescriptor();

                if (!det) {
                    if (attempts % 8 === 0) setFaceStatus('No face detected. Move closer.');
                    return;
                }

                const saved = new Float32Array(Object.values(vol.faceDescriptor) as number[]);
                const dist = faceapi.euclideanDistance(det.descriptor, saved);

                if (dist < 0.5) {
                    // ✅ Match — check in or out
                    clearInterval(intervalRef.current);
                    stopCamera();
                    const isCheckedIn = !!statusMapRef.current[vol.id];
                    try {
                        if (isCheckedIn) {
                            await checkOut.mutateAsync(vol.id);
                            toast({ title: `Goodbye, ${vol.name.split(' ')[0]}! 👋`, description: 'Checked out successfully ✅' });
                        } else {
                            await checkIn.mutateAsync({ userId: vol.id, userName: vol.name, userPhoto: vol.photo || '' });
                            toast({ title: `Welcome, ${vol.name.split(' ')[0]}! 🎉`, description: 'Checked in successfully ✅' });
                        }
                    } catch (err: any) {
                        toast({ title: 'Error', description: err?.message || 'Something went wrong', variant: 'destructive' });
                    }
                    closeModal();
                } else if (attempts > 40) {
                    // Timed out
                    clearInterval(intervalRef.current);
                    stopCamera();
                    setFaceStatus('Face not recognised. Please try again.');
                } else {
                    setFaceStatus(dist < 0.65 ? 'Almost… hold still' : 'Verifying…');
                }
            } catch {}
        }, 350);
    };

    const handleTap = async (vol: any) => {
        setVerifyingVol(vol);
        setFaceStatus('Preparing…');

        // Volunteer doc may not have faceDescriptor — check members collection as fallback
        let faceDescriptor = vol.faceDescriptor;
        if (!faceDescriptor && club?.id) {
            try {
                const memberDoc = await getDoc(doc(db, `clubs/${club.id}/members`, vol.id));
                if (memberDoc.exists()) {
                    faceDescriptor = memberDoc.data().faceDescriptor;
                }
            } catch {}
        }

        const volWithFace = faceDescriptor ? { ...vol, faceDescriptor } : vol;
        setFaceStatus(modelsLoaded ? 'Starting camera…' : 'Loading face models…');
        setTimeout(() => startVerification(volWithFace), 400);
    };

    if (isLoading || statusLoading) {
        return (
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 p-6">
                {Array(8).fill(0).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}
            </div>
        );
    }

    return (
        <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 p-4">
                {volunteers?.filter((v) => v.status === "active").map((vol) => {
                    const status = statusMap[vol.id];
                    const isIn = !!status;
                    const didNotLogout = forgotLogoutSet.has(vol.id);

                    const borderClass = isIn
                        ? "border-emerald-300 bg-emerald-50"
                        : didNotLogout
                        ? "border-red-300 bg-red-50"
                        : "border-gray-200 bg-white hover:border-violet-300";

                    return (
                        <button
                            key={vol.id}
                            onClick={() => handleTap(vol)}
                            className={`flex flex-col items-center gap-3 p-5 rounded-2xl border-2 transition-all hover:shadow-lg active:scale-95 ${borderClass}`}
                        >
                            <Avatar className="h-20 w-20">
                                {vol.photo ? <AvatarImage src={vol.photo} /> : null}
                                <AvatarFallback className="text-2xl font-bold bg-violet-100 text-violet-700">
                                    {vol.name[0]}
                                </AvatarFallback>
                            </Avatar>
                            <p className="text-sm font-bold text-center truncate w-full">{vol.name}</p>
                            <div className="flex items-center gap-1.5">
                                <div className={`w-2.5 h-2.5 rounded-full ${isIn ? "bg-emerald-500 animate-pulse" : didNotLogout ? "bg-red-500" : "bg-gray-300"}`} />
                                <span className={`text-xs font-medium ${isIn ? "text-emerald-700" : didNotLogout ? "text-red-600" : "text-muted-foreground"}`}>
                                    {isIn
                                        ? `In at ${status!.checkInTime?.toDate?.().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                                        : didNotLogout
                                        ? "Did not log out"
                                        : "Not In"}
                                </span>
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* ── Face Verification Modal ── */}
            {verifyingVol && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-sm flex flex-col items-center gap-5 mx-4">

                        {/* Header */}
                        <div className="flex items-center gap-3 w-full">
                            <Avatar className="h-12 w-12 ring-2 ring-violet-300">
                                {verifyingVol.photo ? <AvatarImage src={verifyingVol.photo} /> : null}
                                <AvatarFallback className="bg-violet-100 text-violet-700 font-bold text-lg">
                                    {verifyingVol.name[0]}
                                </AvatarFallback>
                            </Avatar>
                            <div>
                                <p className="font-bold text-gray-900 text-base">{verifyingVol.name}</p>
                                <p className="text-xs text-muted-foreground">
                                    {statusMapRef.current[verifyingVol.id] ? '🔴 Checking out…' : '🟢 Checking in…'}
                                </p>
                            </div>
                        </div>

                        {/* Camera feed */}
                        <div className="relative w-full rounded-2xl overflow-hidden bg-black" style={{ aspectRatio: '4/3' }}>
                            <video
                                ref={videoRef}
                                autoPlay
                                muted
                                playsInline
                                className="w-full h-full object-cover"
                                style={{ transform: 'scaleX(-1)' }}
                            />
                            {/* Corner brackets overlay */}
                            <div className="absolute inset-0 pointer-events-none">
                                <div className="absolute top-3 left-3 w-8 h-8 border-t-4 border-l-4 border-violet-400 rounded-tl-lg" />
                                <div className="absolute top-3 right-3 w-8 h-8 border-t-4 border-r-4 border-violet-400 rounded-tr-lg" />
                                <div className="absolute bottom-3 left-3 w-8 h-8 border-b-4 border-l-4 border-violet-400 rounded-bl-lg" />
                                <div className="absolute bottom-3 right-3 w-8 h-8 border-b-4 border-r-4 border-violet-400 rounded-br-lg" />
                            </div>
                        </div>

                        {/* Status text */}
                        <p className="text-sm font-semibold text-center text-gray-700 min-h-[20px]">{faceStatus}</p>

                        <button
                            onClick={closeModal}
                            className="w-full py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
