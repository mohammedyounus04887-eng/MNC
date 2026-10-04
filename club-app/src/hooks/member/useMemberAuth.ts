import { useState, useEffect } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut as fbSignOut, sendPasswordResetEmail, updatePassword } from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import type { User } from "@/types/firestore";

interface MemberAuthResult {
    member: User | null;
    loading: boolean;
    error: string | null;
    mustChangePassword: boolean;
    signIn: (email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
    resetPassword: (email: string) => Promise<void>;
    changePassword: (newPassword: string) => Promise<void>;
}

export function useMemberAuth(): MemberAuthResult {
    const { club } = useClubContext();
    const [member, setMember] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [mustChangePassword, setMustChangePassword] = useState(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (fbUser) => {
            if (!fbUser || !club) {
                setMember(null);
                setLoading(false);
                return;
            }
            try {
                if (fbUser.email) {
                    // Membership is granted to this Auth UID, never inferred from email equality.
                    const snapshot = await getDoc(doc(db, `clubs/${club.id}/members`, fbUser.uid));
                    if (snapshot.exists()) {
                        const data = snapshot.data();
                        setMember({ id: snapshot.id, clubId: club.id, ...data, role: "member" } as unknown as User);
                        if (data.mustChangePassword) {
                            setMustChangePassword(true);
                        }
                    } else {
                        setMember(null);
                        setError("No member account found for this club.");
                    }
                } else {
                    setMember(null);
                    setError("No email found in authentication.");
                }
            } catch (e: any) {
                setError(e.message);
                setMember(null);
            }
            setLoading(false);
        });
        return () => unsub();
    }, [club]);

    const signIn = async (email: string, password: string) => {
        setError(null);
        try {
            await signInWithEmailAndPassword(auth, email, password);
        } catch (e: any) {
            if (e.code === "auth/wrong-password" || e.code === "auth/invalid-credential") throw new Error("Incorrect password");
            if (e.code === "auth/user-not-found") throw new Error("No account found with this email");
            if (e.code === "auth/too-many-requests") throw new Error("Too many attempts. Try again later.");
            throw e;
        }
    };

    const signOut = async () => {
        await fbSignOut(auth);
        setMember(null);
        setMustChangePassword(false);
    };

    const resetPassword = async (email: string) => {
        await sendPasswordResetEmail(auth, email);
    };

    const changePassword = async (newPassword: string) => {
        const fbUser = auth.currentUser;
        if (!fbUser) throw new Error("Not logged in");
        if (!newPassword || newPassword.length < 6) throw new Error("Password must be at least 6 characters");

        await updatePassword(fbUser, newPassword);

        // Clear the mustChangePassword flag in Firestore
        if (member && club) {
            await updateDoc(doc(db, `clubs/${club.id}/members`, member.id), {
                mustChangePassword: false,
            });
        }
        setMustChangePassword(false);
    };

    return { member, loading, error, mustChangePassword, signIn, signOut, resetPassword, changePassword };
}
