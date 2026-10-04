import { useState } from "react";
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";
import {
    doc, updateDoc, arrayUnion, arrayRemove, Timestamp,
    collection, addDoc, getDocs, query, orderBy, limit,
} from "firebase/firestore";
import { db, storage } from "@/lib/firebase";
import type { LandingImage } from "@/types/firestore";

// ─── Upload an image for a club's landing page ──────────────────────────

export function useUploadLandingImage(clubId: string) {
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);

    async function upload(file: File, label: string): Promise<LandingImage> {
        setUploading(true);
        setProgress(0);
        setError(null);

        try {
            const storagePath = `clubs/${clubId}/images/${Date.now()}_${file.name}`;
            const storageRef = ref(storage, storagePath);
            const uploadTask = uploadBytesResumable(storageRef, file);

            const url = await new Promise<string>((resolve, reject) => {
                uploadTask.on(
                    "state_changed",
                    (snap) => setProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
                    (err) => reject(err),
                    async () => {
                        const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
                        resolve(downloadUrl);
                    }
                );
            });

            const image: LandingImage = {
                id: `img_${Date.now()}`,
                name: label,
                url,
                path: storagePath,
                uploadedAt: Timestamp.now(),
            };

            await updateDoc(doc(db, "clubs", clubId), {
                landingPageImages: arrayUnion(image),
            });

            return image;
        } catch (err: any) {
            setError(err?.message ?? "Upload failed");
            throw err;
        } finally {
            setUploading(false);
            setProgress(0);
        }
    }

    return { upload, uploading, progress, error };
}

// ─── Delete a landing image ─────────────────────────────────────────────

export function useDeleteLandingImage(clubId: string) {
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function deleteImage(image: LandingImage) {
        setDeleting(true);
        setError(null);

        try {
            const storageRef = ref(storage, image.path);
            await deleteObject(storageRef);
            await updateDoc(doc(db, "clubs", clubId), {
                landingPageImages: arrayRemove(image),
            });
        } catch (err: any) {
            setError(err?.message ?? "Delete failed");
            throw err;
        } finally {
            setDeleting(false);
        }
    }

    return { deleteImage, deleting, error };
}

// ─── Upload Landing Page HTML ─────────────────────────────────────────────
// Every publish:
//  1. Uploads a versioned copy → clubs/{clubId}/landing/v{N}.html  (preserved forever)
//  2. Overwrites the active file  → clubs/{clubId}/landing/index.html
//  3. Writes a version record → clubs/{clubId}/landingPages/{docId}
//  4. Updates clubs/{clubId}.landingPageUrl + landingPageVersion

export function useUploadLandingHTML(clubId: string) {
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function uploadHTML(htmlContent: string): Promise<string> {
        setUploading(true);
        setError(null);

        try {
            const now = Timestamp.now();

            // 1. Determine next version number
            const versionsSnap = await getDocs(
                query(collection(db, `clubs/${clubId}/landingPages`), orderBy("publishedAt", "desc"), limit(1))
            );
            const latestVersion = versionsSnap.empty ? 0 : (versionsSnap.docs[0].data().version ?? 0);
            const nextVersion = (latestVersion as number) + 1;

            const versionedPath = `clubs/${clubId}/landing/v${nextVersion}.html`;
            const activePath = `clubs/${clubId}/landing/index.html`;
            const htmlBlob = new Blob([htmlContent], { type: "text/html" });

            // 2. Upload versioned snapshot to Storage
            const versionedRef = ref(storage, versionedPath);
            await new Promise<void>((resolve, reject) => {
                const task = uploadBytesResumable(versionedRef, htmlBlob, { contentType: "text/html" });
                task.on("state_changed", null, reject, () => resolve());
            });
            const versionedUrl = await getDownloadURL(versionedRef);

            // 3. Overwrite active index.html
            const activeRef = ref(storage, activePath);
            const activeBlob = new Blob([htmlContent], { type: "text/html" });
            const uploadTask = uploadBytesResumable(activeRef, activeBlob, { contentType: "text/html" });
            const activeUrl = await new Promise<string>((resolve, reject) => {
                uploadTask.on(
                    "state_changed",
                    null,
                    (err) => reject(err),
                    async () => resolve(await getDownloadURL(uploadTask.snapshot.ref))
                );
            });

            // 4. Save version record inside clubs/{clubId}/landingPages/
            await addDoc(collection(db, `clubs/${clubId}/landingPages`), {
                version: nextVersion,
                status: "active",
                storagePath: versionedPath,
                activeStoragePath: activePath,
                url: versionedUrl,         // versioned copy URL (permanent)
                activeUrl,                  // index.html URL (changes each publish)
                publishedAt: now,
                publishedBy: "superadmin",
                sizeBytes: htmlBlob.size,
            });

            // 5. Update club document pointers
            await updateDoc(doc(db, "clubs", clubId), {
                landingPageUrl: activeUrl,
                landingPageVersion: nextVersion,
                landingPageUpdatedAt: now,
            });

            return activeUrl;
        } catch (err: any) {
            setError(err?.message ?? "Upload failed");
            throw err;
        } finally {
            setUploading(false);
        }
    }

    return { uploadHTML, uploading, error };
}

// ─── useClubLandingPageVersions ───────────────────────────────────────────
// Fetches the publish history from clubs/{clubId}/landingPages

export function useClubLandingPageVersions(clubId: string | null) {
    const [versions, setVersions] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    async function fetchVersions() {
        if (!clubId) return;
        setLoading(true);
        try {
            const snap = await getDocs(
                query(collection(db, `clubs/${clubId}/landingPages`), orderBy("publishedAt", "desc"))
            );
            setVersions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        } finally {
            setLoading(false);
        }
    }

    return { versions, loading, fetchVersions };
}
