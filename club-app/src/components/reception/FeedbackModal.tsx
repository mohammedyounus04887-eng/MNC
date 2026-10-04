import { useState, useCallback } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import { useSubmitFeedback } from "@/hooks/useFeedback";
import { Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Feedback } from "@/types/firestore";

const CATEGORIES: Feedback["category"][] = ["Service", "Shakes", "Cleanliness", "Staff", "Timing", "Other"];

interface Props {
    onClose: () => void;
}

export default function FeedbackModal({ onClose }: Props) {
    const { club } = useClubContext();
    const submitFeedback = useSubmitFeedback();

    const [name, setName] = useState("");
    const [memberId, setMemberId] = useState("");
    const [rating, setRating] = useState(0);
    const [hoveredRating, setHoveredRating] = useState(0);
    const [category, setCategory] = useState<Feedback["category"]>("Service");
    const [message, setMessage] = useState("");
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = useCallback(async () => {
        if (!club?.id || rating === 0) return;

        const payload: any = {
            clubId: club.id,
            rating,
            category,
            source: "reception",
        };

        if (name.trim()) payload.name = name.trim();
        if (memberId.trim()) payload.memberId = memberId.trim();
        if (message.trim()) payload.message = message.trim();

        await submitFeedback.mutateAsync(payload);

        setSubmitted(true);
        setTimeout(() => onClose(), 3000);
    }, [club, name, memberId, rating, category, message, submitFeedback, onClose]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div
                className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-6 relative"
                style={{ fontFamily: "Nunito, sans-serif" }}
            >
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
                >
                    <X className="w-6 h-6" />
                </button>

                {submitted ? (
                    <div className="text-center py-12 space-y-4">
                        <div className="text-6xl">🌿</div>
                        <h2 className="text-2xl font-black text-gray-800">
                            Thank you for your feedback!
                        </h2>
                        <p className="text-gray-500">We appreciate you taking the time.</p>
                    </div>
                ) : (
                    <>
                        <h2 className="text-2xl font-black text-gray-800 mb-1">Share Your Feedback 💬</h2>
                        <p className="text-sm text-gray-500 mb-6">Help us serve you better</p>

                        <div className="space-y-4">
                            {/* Name */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">
                                    Name <span className="text-gray-400 font-normal">(optional)</span>
                                </label>
                                <Input
                                    placeholder="Your name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="rounded-xl"
                                />
                            </div>

                            {/* Member ID */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">
                                    Member ID <span className="text-gray-400 font-normal">(optional)</span>
                                </label>
                                <Input
                                    placeholder="e.g. MNC-A-001"
                                    value={memberId}
                                    onChange={(e) => setMemberId(e.target.value)}
                                    className="rounded-xl"
                                />
                            </div>

                            {/* Rating */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">
                                    Rating
                                </label>
                                <div className="flex gap-2">
                                    {[1, 2, 3, 4, 5].map((star) => (
                                        <button
                                            key={star}
                                            onClick={() => setRating(star)}
                                            onMouseEnter={() => setHoveredRating(star)}
                                            onMouseLeave={() => setHoveredRating(0)}
                                            className="transition-transform hover:scale-110"
                                        >
                                            <Star
                                                className="w-10 h-10"
                                                fill={(hoveredRating || rating) >= star ? "#f59e0b" : "none"}
                                                stroke={(hoveredRating || rating) >= star ? "#f59e0b" : "#d1d5db"}
                                                strokeWidth={1.5}
                                            />
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Category */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">
                                    Category
                                </label>
                                <Select value={category} onValueChange={(v) => setCategory(v as Feedback["category"])}>
                                    <SelectTrigger className="rounded-xl">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {CATEGORIES.map((c) => (
                                            <SelectItem key={c} value={c}>{c}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Message */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">
                                    Message <span className="text-gray-400 font-normal">(optional)</span>
                                </label>
                                <Textarea
                                    placeholder="Tell us more..."
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    rows={3}
                                    className="rounded-xl"
                                />
                            </div>

                            <Button
                                onClick={handleSubmit}
                                disabled={rating === 0 || submitFeedback.isPending}
                                className="w-full h-12 rounded-xl text-white font-bold text-base"
                                style={{ backgroundColor: "#2d9653" }}
                            >
                                {submitFeedback.isPending ? "Submitting..." : "Submit Feedback"}
                            </Button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
