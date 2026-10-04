import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import ReviewForm from "@/components/member/ReviewForm";
import type { Club } from "@/types/firestore";

export default function LeaveReviewPage() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const [club, setClub] = useState<Club | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const clubId = searchParams.get("clubId");

    useEffect(() => {
        if (!clubId) {
            setError("No club specified");
            setLoading(false);
            return;
        }

        const loadClub = async () => {
            try {
                setLoading(true);
                const snap = await getDoc(doc(db, "clubs", clubId));
                if (snap.exists()) {
                    setClub({ id: snap.id, ...snap.data() } as Club);
                } else {
                    setError("Club not found");
                }
            } catch (err) {
                console.error(err);
                setError("Failed to load club information");
            } finally {
                setLoading(false);
            }
        };

        loadClub();
    }, [clubId]);

    if (!clubId) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-red-100 p-4">
                <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md text-center space-y-4" style={{ fontFamily: "Nunito, sans-serif" }}>
                    <h1 className="text-2xl font-black text-red-600">⚠️ Error</h1>
                    <p className="text-gray-600">Invalid QR code. Please scan again.</p>
                    <button
                        onClick={() => navigate("/")}
                        className="w-full bg-red-500 text-white py-3 rounded-xl font-bold hover:bg-red-600 transition"
                    >
                        Go Home
                    </button>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 to-orange-50 p-4">
                <div className="text-center space-y-4">
                    <div className="inline-block">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500"></div>
                    </div>
                    <p className="text-gray-600 font-semibold">Loading...</p>
                </div>
            </div>
        );
    }

    if (error || !club) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-red-100 p-4">
                <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md text-center space-y-4" style={{ fontFamily: "Nunito, sans-serif" }}>
                    <h1 className="text-2xl font-black text-red-600">❌ Error</h1>
                    <p className="text-gray-600">{error}</p>
                    <button
                        onClick={() => navigate("/")}
                        className="w-full bg-red-500 text-white py-3 rounded-xl font-bold hover:bg-red-600 transition"
                    >
                        Go Home
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 p-4 py-8" style={{ fontFamily: "Nunito, sans-serif" }}>
            <div className="max-w-2xl mx-auto">
                {/* Header */}
                <div className="bg-gradient-to-r from-amber-400 to-orange-400 rounded-3xl shadow-lg p-8 mb-6 text-center">
                    <h1 className="text-3xl font-black text-white mb-2">⭐ Leave a Google Review</h1>
                    <p className="text-amber-50 text-sm font-semibold">Tell us about your {club?.name || "club"} experience!</p>
                </div>

                {/* Review Form */}
                <div className="bg-white rounded-3xl shadow-2xl p-8">
                    <ReviewForm 
                        clubId={clubId}
                        onClose={() => navigate("/")}
                    />
                </div>

                {/* Footer */}
                <div className="text-center mt-6">
                    <p className="text-gray-500 text-sm">
                        Your feedback helps us improve! ❤️
                    </p>
                </div>
            </div>
        </div>
    );
}
