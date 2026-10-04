import { useState, useEffect, useRef } from "react";
import { collection, getDocs, query, where, addDoc, setDoc, doc, Timestamp } from "firebase/firestore";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { useQuery } from "@tanstack/react-query";
import { db, auth } from "@/lib/firebase";
import { useSearchParams, useNavigate } from "react-router-dom";
import { CheckCircle, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { generateMemberId, generatePrefixFromName } from "@/utils/generateMemberId";
import { useAuth } from "@/lib/auth";
import type { Club } from "@/types/firestore";

const GREEN = "#2d9653";

// Lookup club by clubId query param
function useClubFromParams() {
    const [params] = useSearchParams();
    const clubId = params.get("clubId") ?? "";

    return useQuery({
        queryKey: ["join-club", clubId],
        queryFn: async () => {
            if (!clubId) {
                // Try to load default if only one club
                const snap = await getDocs(collection(db, "clubs"));
                if (snap.size === 1) return { id: snap.docs[0].id, ...snap.docs[0].data() } as Club;
                return null;
            }
            const snap = await getDocs(query(collection(db, "clubs"), where("__name__", "==", clubId)));
            if (snap.empty) return null;
            return { id: snap.docs[0].id, ...snap.docs[0].data() } as Club;
        },
        enabled: true,
    });
}

export default function Join() {
    const { data: club, isLoading: clubLoading } = useClubFromParams();
    const { refreshProfile } = useAuth();
    const navigate = useNavigate();

    const [form, setForm] = useState({
        name: "",
        phone: "",
        whatsapp: "",
        email: "",
        password: "",
        confirmPassword: "",
        address: "",
        dob: "",
        currentWeight: "",
        targetWeight: "",
        healthConditions: "",
        referredByMemberId: "",
        noReferrer: false,
    });

    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [redirectIn, setRedirectIn] = useState(8);

    // After a successful signup, count down and send the new member to the
    // login page so they can sign in with their email + password right away.
    useEffect(() => {
        if (!submitted) return;
        setRedirectIn(8);
        const tick = setInterval(() => setRedirectIn(n => (n > 0 ? n - 1 : 0)), 1000);
        const go = setTimeout(() => {
            navigate(club?.id ? `/member/login?clubId=${club.id}` : "/member/login");
        }, 8000);
        return () => { clearInterval(tick); clearTimeout(go); };
    }, [submitted, club?.id, navigate]);
    const [generatedId, setGeneratedId] = useState("");
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [referrerSearch, setReferrerSearch] = useState("");
    const [allMembers, setAllMembers] = useState<Array<{ id: string; name: string; memberId: string; phone?: string }>>([]);
    const [referrerName, setReferrerName] = useState("");
    const [showMemberList, setShowMemberList] = useState(false);
    const referrerRef = useRef<HTMLDivElement>(null);
    const [submitError, setSubmitError] = useState("");

    const handleChange = (field: string, value: string | boolean) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    };

    // Load all members for referral search once club is known
    useEffect(() => {
        if (!club) return;
        getDocs(collection(db, `clubs/${club.id}/members`)).then((snap) => {
            setAllMembers(
                snap.docs
                    .map((d) => {
                        const data = d.data();
                        return { id: d.id, name: data.name ?? "", memberId: data.memberId ?? "", phone: data.phone ?? "" };
                    })
                    .filter((m) => m.name)
            );
        }).catch(() => {});
    }, [club?.id]);

    // Close member list on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (referrerRef.current && !referrerRef.current.contains(e.target as Node)) {
                setShowMemberList(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    const filteredMembers = allMembers.filter((m) => {
        if (form.noReferrer) return false;
        const q = referrerSearch.toLowerCase();
        return !q || m.name.toLowerCase().includes(q) || m.memberId.toLowerCase().includes(q) || (m.phone ?? "").includes(q);
    });

    const validate = (): boolean => {
        const errs: Record<string, string> = {};
        if (!form.name.trim()) errs.name = "Name is required";
        if (!form.phone.trim()) errs.phone = "Phone is required";
        if (!form.email.trim()) errs.email = "Email is required for login";
        if (form.password.length < 6) errs.password = "Password must be at least 6 characters";
        if (form.password !== form.confirmPassword) errs.confirmPassword = "Passwords do not match";
        setErrors(errs);
        return Object.keys(errs).length === 0;
    };

    const handleSubmit = async () => {
        if (!validate() || !club) return;
        setSubmitting(true);
        setSubmitError("");
        try {
            // 1. Create Firebase Auth account
            const userCredential = await createUserWithEmailAndPassword(auth, form.email.trim(), form.password);
            const uid = userCredential.user.uid;

            // 2. Generate Member ID
            const prefix = (club as any).memberIdPrefix || generatePrefixFromName(club.name);
            const memberId = await generateMemberId(club.id, prefix);
            const now = Timestamp.now();

            // 3. Build treePath from referrer
            let treePath = uid;
            const referrerId = (!form.noReferrer && form.referredByMemberId.trim()) ? form.referredByMemberId.trim() : null;
            if (referrerId) {
                const refSnap = await getDocs(
                    query(collection(db, `clubs/${club.id}/members`), where("memberId", "==", referrerId))
                );
                if (!refSnap.empty) {
                    const refData = refSnap.docs[0].data();
                    treePath = (refData.treePath ?? refSnap.docs[0].id) + "/" + uid;
                }
            }

            // 4. Create member document at clubs/{clubId}/members/{uid}
            await setDoc(doc(db, `clubs/${club.id}/members`, uid), {
                id: uid,
                name: form.name.trim(),
                phone: form.phone.trim(),
                whatsapp: form.whatsapp.trim() || form.phone.trim(),
                email: form.email.trim(),
                address: form.address.trim() || "",
                photo: "",
                role: "member",
                clubId: club.id,
                parentUserId: null,
                treePath,
                isPermanent: false,
                status: "active",
                dob: form.dob ? Timestamp.fromDate(new Date(form.dob)) : null,
                anniversary: null,
                qrCode: "",
                isClubOwner: false,
                ownedClubId: null,
                originalClubId: club.id,
                referredBy: referrerId,
                referredByMemberId: referrerId,
                memberType: "permanent",
                isActiveMember: true,
                activatedAt: now,
                shakeCredits: 0,
                shakeCreditsPlanTotal: 0,
                memberId,
                currentWeight: form.currentWeight ? parseFloat(form.currentWeight) : null,
                targetWeight: form.targetWeight ? parseFloat(form.targetWeight) : null,
                startingWeight: form.currentWeight ? parseFloat(form.currentWeight) : null,
                healthConditions: form.healthConditions.trim() || "",
                passwordChanged: false,
                badges: [],
                totalWeighIns: 0,
                createdAt: now,
                updatedAt: now,
            });

            // 5. Create wallet
            await setDoc(doc(db, `clubs/${club.id}/members/${uid}/wallet`, "data"), {
                userId: uid,
                clubId: club.id,
                currencyName: (club as any).currencyName || "Coins",
                balance: 0,
                lastUpdated: now,
            });

            // 6. Save enquiry record for owner's reference
            await addDoc(collection(db, `clubs/${club.id}/enquiries`), {
                clubId: club.id,
                name: form.name.trim(),
                phone: form.phone.trim(),
                whatsapp: form.whatsapp.trim() || form.phone.trim(),
                email: form.email.trim() || null,
                address: form.address.trim() || null,
                dob: form.dob || null,
                currentWeight: form.currentWeight ? parseFloat(form.currentWeight) : null,
                targetWeight: form.targetWeight ? parseFloat(form.targetWeight) : null,
                healthConditions: form.healthConditions.trim() || null,
                referredByMemberId: referrerId,
                status: "converted",
                autoRegistered: true,
                memberDocId: uid,
                memberId,
                createdAt: now,
                source: "join-page",
            });

            // Refresh the global auth profile so ProtectedRoute gets role='member'
            // (createUserWithEmailAndPassword fires onAuthStateChanged before the
            //  Firestore doc exists, leaving role=null in the auth context)
            await refreshProfile();

            setGeneratedId(memberId);
            setSubmitted(true);
        } catch (err: any) {
            console.error("Registration error:", err);
            if (err.code === "auth/email-already-in-use") {
                setSubmitError("This email is already registered. Please use a different email or log in.");
            } else if (err.code === "auth/invalid-email") {
                setSubmitError("Please enter a valid email address.");
            } else {
                setSubmitError(err.message || "Registration failed. Please try again.");
            }
        } finally {
            setSubmitting(false);
        }
    };

    if (clubLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ fontFamily: "Nunito, sans-serif" }}>
                <Loader2 className="w-10 h-10 animate-spin" style={{ color: GREEN }} />
            </div>
        );
    }

    if (!club) {
        return (
            <div className="min-h-screen flex items-center justify-center p-8 text-center" style={{ fontFamily: "Nunito, sans-serif" }}>
                <div>
                    <p className="text-2xl font-black text-gray-400">Club not found</p>
                    <p className="text-gray-400 mt-2">Please check your link and try again.</p>
                </div>
            </div>
        );
    }

    if (submitted) {
        return (
            <div
                className="min-h-screen flex flex-col items-center justify-center p-8 text-center"
                style={{ fontFamily: "Nunito, sans-serif", backgroundColor: "#f8fffe" }}
            >
                <CheckCircle className="w-20 h-20 mb-6" style={{ color: GREEN }} />
                <h1 className="text-3xl font-black text-gray-800 mb-3">Welcome! 🎉</h1>
                <p className="text-lg text-gray-600 mb-2">
                    Your account has been created successfully!
                </p>
                {generatedId && (
                    <div className="bg-white rounded-2xl border-2 border-emerald-200 p-5 shadow-sm mb-6">
                        <p className="text-sm text-gray-500 mb-1">Your Member ID</p>
                        <p className="text-3xl font-black" style={{ color: GREEN }}>{generatedId}</p>
                        <p className="text-xs text-gray-400 mt-2">Save this — you'll need it for referrals</p>
                    </div>
                )}
                <p className="text-sm text-gray-500 mb-4">
                    You can now log in to the member portal with your email and password.
                </p>
                <div className="mb-6">
                    <button
                        onClick={() => navigate(club.id ? `/member/login?clubId=${club.id}` : "/member/login")}
                        className="rounded-xl px-6 py-3 font-black text-white shadow-sm"
                        style={{ backgroundColor: GREEN }}
                    >
                        Go to Login now →
                    </button>
                    <p className="text-xs text-gray-400 mt-2">
                        Redirecting to login in {redirectIn}s…
                    </p>
                </div>
                <div className="bg-white rounded-2xl border p-5 shadow-sm">
                    <p className="text-sm text-gray-500 mb-2">For assistance, contact:</p>
                    <p className="font-black text-xl" style={{ color: GREEN }}>
                        {club.name}
                    </p>
                    {club.ownerPhone && (
                        <a href={`tel:${club.ownerPhone}`} className="text-lg font-bold text-blue-600 mt-1 block">
                            📞 {club.ownerPhone}
                        </a>
                    )}
                </div>
            </div>
        );
    }

    const inputClass = "rounded-xl border-gray-200";

    return (
        <div
            className="min-h-screen pb-16"
            style={{ fontFamily: "Nunito, sans-serif", backgroundColor: "#f8fffe" }}
        >
            {/* Header */}
            <div className="bg-white border-b shadow-sm px-5 py-5 flex items-center gap-4">
                {club.logo && (
                    <img src={club.logo} alt={club.name} className="h-12 object-contain rounded-xl" />
                )}
                <div>
                    <h1 className="text-xl font-black" style={{ color: GREEN }}>{club.name}</h1>
                    <p className="text-sm text-gray-500">Join us — create your member account</p>
                </div>
            </div>

            <div className="max-w-lg mx-auto px-5 pt-6 space-y-4">
                <h2 className="text-2xl font-black text-gray-800">Register as Member</h2>
                <p className="text-sm text-gray-500">Fields marked with * are required.</p>

                {submitError && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 font-medium">
                        ⚠️ {submitError}
                    </div>
                )}

                {/* Name */}
                <Field label="Full Name *" error={errors.name}>
                    <Input className={inputClass} placeholder="Your full name" value={form.name} onChange={(e) => handleChange("name", e.target.value)} />
                </Field>

                {/* Phone */}
                <Field label="Phone Number *" error={errors.phone}>
                    <Input className={inputClass} type="tel" placeholder="+91 XXXXX XXXXX" value={form.phone} onChange={(e) => handleChange("phone", e.target.value)} />
                </Field>

                {/* WhatsApp */}
                <Field label="WhatsApp Number">
                    <Input className={inputClass} type="tel" placeholder="Same as phone or different" value={form.whatsapp} onChange={(e) => handleChange("whatsapp", e.target.value)} />
                </Field>

                {/* Email */}
                <Field label="Email *" error={errors.email}>
                    <Input className={inputClass} type="email" placeholder="your@email.com" value={form.email} onChange={(e) => handleChange("email", e.target.value)} />
                </Field>

                {/* Password */}
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Password *" error={errors.password}>
                        <Input className={inputClass} type="password" placeholder="Min 6 characters" value={form.password} onChange={(e) => handleChange("password", e.target.value)} />
                    </Field>
                    <Field label="Confirm Password *" error={errors.confirmPassword}>
                        <Input className={inputClass} type="password" placeholder="Re-enter password" value={form.confirmPassword} onChange={(e) => handleChange("confirmPassword", e.target.value)} />
                    </Field>
                </div>

                {/* Address */}
                <Field label="Address">
                    <Input className={inputClass} placeholder="Your address" value={form.address} onChange={(e) => handleChange("address", e.target.value)} />
                </Field>

                {/* DOB */}
                <Field label="Date of Birth">
                    <Input className={inputClass} type="date" value={form.dob} onChange={(e) => handleChange("dob", e.target.value)} />
                </Field>

                {/* Weights */}
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Current Weight (kg)">
                        <Input className={inputClass} type="number" placeholder="e.g. 75" value={form.currentWeight} onChange={(e) => handleChange("currentWeight", e.target.value)} />
                    </Field>
                    <Field label="Target Weight (kg)">
                        <Input className={inputClass} type="number" placeholder="e.g. 65" value={form.targetWeight} onChange={(e) => handleChange("targetWeight", e.target.value)} />
                    </Field>
                </div>

                {/* Health conditions */}
                <Field label="Health Conditions">
                    <Textarea className={inputClass} rows={3} placeholder="Any health conditions we should know about..." value={form.healthConditions} onChange={(e) => handleChange("healthConditions", e.target.value)} />
                </Field>

                {/* Referral */}
                <Field label="Who referred you?">
                    <div className="space-y-2" ref={referrerRef}>
                        {!form.noReferrer && (
                            <div className="relative">
                                {form.referredByMemberId && referrerName ? (
                                    /* Selected member pill */
                                    <div style={{
                                        display: "flex", alignItems: "center", justifyContent: "space-between",
                                        background: "#f0fdf4", border: "2px solid #86efac", borderRadius: 12,
                                        padding: "10px 14px",
                                    }}>
                                        <div>
                                            <span style={{ fontWeight: 700, color: "#166534", fontSize: 14 }}>{referrerName}</span>
                                            <span style={{ fontSize: 12, color: "#6b7280", marginLeft: 6 }}>({form.referredByMemberId})</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => { handleChange("referredByMemberId", ""); setReferrerName(""); setReferrerSearch(""); }}
                                            style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", padding: 4 }}
                                        >
                                            <X size={16} />
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <div style={{ position: "relative" }}>
                                            <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#9ca3af", zIndex: 1 }} />
                                            <Input
                                                className={inputClass}
                                                style={{ paddingLeft: 36 }}
                                                placeholder="Search by name or member ID..."
                                                value={referrerSearch}
                                                onChange={(e) => { setReferrerSearch(e.target.value); setShowMemberList(true); }}
                                                onFocus={() => setShowMemberList(true)}
                                            />
                                        </div>
                                        {showMemberList && filteredMembers.length > 0 && (
                                            <div style={{
                                                position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100,
                                                background: "white", border: "1.5px solid #e5e7eb", borderRadius: 12,
                                                boxShadow: "0 8px 24px rgba(0,0,0,0.12)", maxHeight: 220, overflowY: "auto",
                                                marginTop: 4,
                                            }}>
                                                {filteredMembers.slice(0, 30).map((m) => (
                                                    <button
                                                        key={m.id}
                                                        type="button"
                                                        onClick={() => {
                                                            handleChange("referredByMemberId", m.memberId || m.id);
                                                            setReferrerName(m.name);
                                                            setReferrerSearch("");
                                                            setShowMemberList(false);
                                                        }}
                                                        style={{
                                                            width: "100%", textAlign: "left", padding: "10px 14px",
                                                            background: "none", border: "none", cursor: "pointer",
                                                            borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 10,
                                                        }}
                                                        onMouseEnter={(e) => (e.currentTarget.style.background = "#f0fdf4")}
                                                        onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                                                    >
                                                        <div style={{
                                                            width: 32, height: 32, borderRadius: "50%",
                                                            background: "#2d9653", color: "white",
                                                            display: "flex", alignItems: "center", justifyContent: "center",
                                                            fontSize: 13, fontWeight: 700, flexShrink: 0,
                                                        }}>
                                                            {m.name[0]?.toUpperCase()}
                                                        </div>
                                                        <div>
                                                            <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e" }}>{m.name}</div>
                                                            <div style={{ fontSize: 12, color: "#6b7280" }}>{m.memberId || m.id}</div>
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        {showMemberList && referrerSearch && filteredMembers.length === 0 && (
                                            <div style={{
                                                position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100,
                                                background: "white", border: "1.5px solid #e5e7eb", borderRadius: 12,
                                                padding: "12px 14px", marginTop: 4, fontSize: 13, color: "#9ca3af", textAlign: "center",
                                            }}>
                                                No members found
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                        <label className="flex items-center gap-2 text-sm text-gray-600">
                            <input
                                type="checkbox"
                                checked={form.noReferrer}
                                onChange={(e) => {
                                    handleChange("noReferrer", e.target.checked);
                                    if (e.target.checked) { handleChange("referredByMemberId", ""); setReferrerName(""); setReferrerSearch(""); }
                                }}
                                className="rounded"
                            />
                            No referrer / I came on my own
                        </label>
                    </div>
                </Field>

                <Button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="w-full h-14 rounded-2xl text-white text-base font-black"
                    style={{ backgroundColor: GREEN }}
                >
                    {submitting ? (
                        <><Loader2 className="animate-spin w-5 h-5 mr-2" />Creating Account...</>
                    ) : (
                        "Join Now 🌿"
                    )}
                </Button>
            </div>
        </div>
    );
}

function Field({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) {
    return (
        <div className="space-y-1">
            <label className="block text-sm font-bold text-gray-700">{label}</label>
            {children}
            {error && <p className="text-red-500 text-xs mt-0.5">{error}</p>}
        </div>
    );
}
