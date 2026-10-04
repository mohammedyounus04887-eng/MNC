import { useState, useEffect } from "react";
import { doc, onSnapshot, setDoc, getDoc, deleteDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage } from "@/lib/firebase";

export interface EarlyBirdPhoto {
    photoUrl: string;
    uploadedAt: any; // Firestore Timestamp
    date: string;    // YYYY-MM-DD
}

function todayStr(): string {
    return new Date().toISOString().slice(0, 10);
}

/** Real-time listener for today's early bird photo */
export function useEarlyBird(clubId: string | undefined) {
    const [photo, setPhoto] = useState<EarlyBirdPhoto | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!clubId) { setLoading(false); return; }
        const today = todayStr();
        const docRef = doc(db, `clubs/${clubId}/earlyBird/${today}`);
        const unsub = onSnapshot(docRef, (snap) => {
            if (snap.exists()) {
                const data = snap.data() as EarlyBirdPhoto;
                // Only show if it's today's photo
                if (data.date === today) {
                    setPhoto(data);
                } else {
                    setPhoto(null);
                }
            } else {
                setPhoto(null);
            }
            setLoading(false);
        });
        return unsub;
    }, [clubId]);

    return { photo, loading };
}

/** Upload a photo as today's early bird — blocked if one already exists */
export async function uploadEarlyBirdPhoto(
    clubId: string,
    file: File
): Promise<{ success: boolean; error?: string }> {
    const today = todayStr();
    const docRef = doc(db, `clubs/${clubId}/earlyBird/${today}`);

    // Check if already uploaded today
    const existing = await getDoc(docRef);
    if (existing.exists() && existing.data()?.date === today) {
        return { success: false, error: "Early bird photo already uploaded for today!" };
    }

    try {
        // Upload to Storage
        const storageRef = ref(storage, `clubs/${clubId}/earlyBird/${today}.jpg`);
        await uploadBytes(storageRef, file);
        const photoUrl = await getDownloadURL(storageRef);

        // Save to Firestore
        await setDoc(docRef, {
            photoUrl,
            uploadedAt: new Date(),
            date: today,
        });

        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message || "Upload failed" };
    }
}

/** Admin: delete today's early bird photo so a new one can be uploaded */
export async function deleteEarlyBirdPhoto(clubId: string): Promise<{ success: boolean; error?: string }> {
    const today = todayStr();
    try {
        await deleteDoc(doc(db, `clubs/${clubId}/earlyBird/${today}`));
        try {
            await deleteObject(ref(storage, `clubs/${clubId}/earlyBird/${today}.jpg`));
        } catch { /* ignore if file doesn't exist */ }
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message || "Delete failed" };
    }
}
