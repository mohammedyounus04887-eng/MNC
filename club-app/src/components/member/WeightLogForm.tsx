import { useState } from "react";
import { X, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Props {
    isLoading: boolean;
    onClose: () => void;
    onSubmit: (weight: number, date: string, notes: string) => Promise<void>;
}

export default function WeightLogForm({ isLoading, onClose, onSubmit }: Props) {
    const [weight, setWeight] = useState("");
    const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
    const [notes, setNotes] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const wNumeric = parseFloat(weight);
        if (!wNumeric || wNumeric <= 0) return;
        await onSubmit(wNumeric, date, notes);
    };

    return (
        <div className="bg-white rounded-3xl p-6">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold flex items-center gap-2">
                    <Scale className="w-5 h-5 text-violet-600" /> Log Weight
                </h2>
                <Button variant="ghost" size="icon" onClick={onClose}><X className="w-5 h-5 text-slate-400" /></Button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                    <Label className="text-slate-600">Weight (kg)</Label>
                    <Input
                        type="number"
                        step="0.1"
                        value={weight}
                        onChange={e => setWeight(e.target.value)}
                        placeholder="e.g. 75.5"
                        className="h-12 text-lg"
                        required
                        autoFocus
                    />
                </div>

                <div className="space-y-2">
                    <Label className="text-slate-600">Date</Label>
                    <Input
                        type="date"
                        value={date}
                        onChange={e => setDate(e.target.value)}
                        className="h-12"
                        required
                    />
                </div>

                <div className="space-y-2">
                    <Label className="text-slate-600">Notes (Optional)</Label>
                    <Textarea
                        placeholder="How are you feeling?"
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        rows={3}
                        className="resize-none"
                    />
                </div>

                <Button type="submit" className="w-full h-12 rounded-xl text-base font-bold bg-violet-600 hover:bg-violet-700" disabled={isLoading || !weight}>
                    {isLoading ? "Saving..." : "Save Log"}
                </Button>
            </form>
        </div>
    );
}
