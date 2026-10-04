import { useState } from "react";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Order } from "@/types/firestore";

interface Props {
    order: Order;
    open: boolean;
    onSubmit: (rating: number, note: string) => void;
    onClose: () => void;
}

export default function RatingModal({ order, open, onSubmit, onClose }: Props) {
    const [rating, setRating] = useState(0);
    const [note, setNote] = useState("");
    const [hoveredStar, setHoveredStar] = useState(0);

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>Rate Your Order</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 mt-2">
                    {/* Order summary */}
                    <div className="bg-gray-50 rounded-xl p-3 space-y-1">
                        {order.items.map((item, idx) => (
                            <p key={idx} className="text-sm">{item.productName} × {item.quantity}</p>
                        ))}
                        <p className="text-xs text-muted-foreground mt-1">
                            {order.createdAt?.toDate?.().toLocaleDateString()}
                        </p>
                    </div>

                    {/* Stars */}
                    <div className="flex justify-center gap-2">
                        {[1, 2, 3, 4, 5].map((s) => (
                            <button
                                key={s}
                                onMouseEnter={() => setHoveredStar(s)}
                                onMouseLeave={() => setHoveredStar(0)}
                                onClick={() => setRating(s)}
                                className="transition-transform hover:scale-110"
                            >
                                <Star
                                    className={`w-10 h-10 ${s <= (hoveredStar || rating)
                                            ? "text-yellow-400 fill-yellow-400"
                                            : "text-gray-200"
                                        }`}
                                />
                            </button>
                        ))}
                    </div>

                    {/* Note */}
                    <Textarea
                        placeholder="Tell us more about your shake (optional)"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                    />

                    {/* Actions */}
                    <div className="flex gap-2">
                        <Button
                            className="flex-1"
                            disabled={rating === 0}
                            onClick={() => onSubmit(rating, note)}
                        >
                            Submit Rating
                        </Button>
                    </div>
                    <button onClick={onClose} className="w-full text-center text-xs text-muted-foreground hover:underline">
                        Skip for now
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
