import { useState, useEffect } from "react";
import { doc, onSnapshot, setDoc, deleteDoc, getDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage } from "@/lib/firebase";

export interface FunFridayPhoto {
    photoUrl: string;
    uploadedAt: any;
    validUntil: string; // ISO date string — show until this date
}

/** A photo is valid for 7 days from upload */
function addDays(date: Date, days: number): string {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

function todayStr(): string {
    return new Date().toISOString().slice(0, 10);
}

/** Real-time listener for the current Fun Friday photo */
export function useFunFriday(clubId: string | undefined) {
    const [photo, setPhoto] = useState<FunFridayPhoto | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!clubId) { setLoading(false); return; }
        const docRef = doc(db, `clubs/${clubId}/funFriday/current`);
        const unsub = onSnapshot(docRef, (snap) => {
            if (snap.exists()) {
                const data = snap.data() as FunFridayPhoto;
                // Only show if still within the valid week
                if (data.validUntil >= todayStr()) {
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

/** Admin: upload a new Fun Friday photo (replaces existing) */
export async function uploadFunFridayPhoto(
    clubId: string,
    file: File
): Promise<{ success: boolean; error?: string }> {
    try {
        const storageRef = ref(storage, `clubs/${clubId}/funFriday/current.jpg`);
        await uploadBytes(storageRef, file);
        const photoUrl = await getDownloadURL(storageRef);

        const validUntil = addDays(new Date(), 7);
        await setDoc(doc(db, `clubs/${clubId}/funFriday/current`), {
            photoUrl,
            uploadedAt: new Date(),
            validUntil,
        });
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message || "Upload failed" };
    }
}

/** Admin: delete the Fun Friday photo */
export async function deleteFunFridayPhoto(clubId: string): Promise<{ success: boolean; error?: string }> {
    try {
        await deleteDoc(doc(db, `clubs/${clubId}/funFriday/current`));
        try {
            await deleteObject(ref(storage, `clubs/${clubId}/funFriday/current.jpg`));
        } catch { /* ignore if file doesn't exist */ }
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message || "Delete failed" };
    }
}
