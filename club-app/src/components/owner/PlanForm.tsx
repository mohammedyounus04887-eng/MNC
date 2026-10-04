import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2 } from "lucide-react";

interface PlanData {
    name: string;
    price: number;
    durationDays: number;
    totalVisits: number;
    visits?: number;
    perShakePrice: number;
    benefits: string[];
    color: string;
    isActive: boolean;
    luckyDipEligible: boolean;
    grantsCredits: boolean;
}

interface Props {
    defaultValues?: Partial<PlanData>;
    onSubmit: (data: PlanData) => void;
    isLoading: boolean;
}

export default function PlanForm({ defaultValues, onSubmit, isLoading }: Props) {
    const [name, setName] = useState(defaultValues?.name || "");
    const [price, setPrice] = useState(defaultValues?.price || 0);
    const [days, setDays] = useState(defaultValues?.durationDays || 30);
    const [totalVisits, setTotalVisits] = useState(defaultValues?.totalVisits || (defaultValues as any)?.visits || 0);
    const [perShakePrice, setPerShakePrice] = useState(defaultValues?.perShakePrice || 0);
    const [benefits, setBenefits] = useState<string[]>(defaultValues?.benefits || [""]);
    const [color, setColor] = useState(defaultValues?.color || "#8B5CF6");
    const [isActive, setIsActive] = useState(defaultValues?.isActive ?? true);
    const [luckyDipEligible, setLuckyDipEligible] = useState(defaultValues?.luckyDipEligible ?? false);
    // Default TRUE so every existing plan keeps granting credits exactly as before.
    const [grantsCredits, setGrantsCredits] = useState(defaultValues?.grantsCredits ?? true);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit({
            name,
            price,
            durationDays: days,
            totalVisits,
            visits: totalVisits,
            perShakePrice,
            benefits: benefits.filter(Boolean),
            color,
            isActive,
            luckyDipEligible,
            grantsCredits,
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
                <Label>Plan Name *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gold, Silver, Bronze" required />
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Total Price (₹) *</Label>
                    <Input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} min={0} required />
                </div>
                <div className="space-y-2">
                    <Label>Shake Credits</Label>
                    <Input type="number" value={totalVisits} onChange={(e) => setTotalVisits(Number(e.target.value))} min={0} placeholder="e.g. 25 (optional)" />
                </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Per Shake Price (₹)</Label>
                    <Input type="number" value={perShakePrice} onChange={(e) => setPerShakePrice(Number(e.target.value))} min={0} placeholder="Auto: total/visits" />
                    {totalVisits > 0 && price > 0 && !perShakePrice && (
                        <p className="text-xs text-muted-foreground">≈ ₹{Math.round(price / totalVisits)} per shake</p>
                    )}
                </div>
                <div className="space-y-2">
                    <Label>Valid Duration (days)</Label>
                    <Input type="number" value={days} onChange={(e) => setDays(Number(e.target.value))} min={1} />
                    <p className="text-xs text-muted-foreground">Credits expire after this many days</p>
                </div>
            </div>
            <div className="space-y-2">
                <Label>Benefits</Label>
                {benefits.map((b, i) => (
                    <div key={i} className="flex gap-2">
                        <Input value={b} onChange={(e) => { const copy = [...benefits]; copy[i] = e.target.value; setBenefits(copy); }} placeholder={`Benefit ${i + 1}`} />
                        {benefits.length > 1 && (
                            <Button type="button" size="icon" variant="ghost" onClick={() => setBenefits(benefits.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></Button>
                        )}
                    </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => setBenefits([...benefits, ""])} className="text-xs"><Plus className="w-3 h-3 mr-1" /> Add Benefit</Button>
            </div>
            <div className="flex items-center gap-3">
                <Label>Color</Label>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-10 h-10 rounded-lg cursor-pointer border-0" />
            </div>
            <div className="flex items-center gap-3">
                <Label>Active</Label>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
                <div className="flex items-center gap-3">
                    <Switch checked={luckyDipEligible} onCheckedChange={setLuckyDipEligible} />
                    <div className="min-w-0">
                        <Label className="block font-bold text-amber-900">🎲 Available for Lucky Dip</Label>
                        <p className="text-[11px] text-amber-700 leading-snug mt-0.5">
                            When ON, renewing this plan while holding ≥1 credit qualifies the member for the monthly Lucky Dip award pool. Leave OFF for one-off / trial / single-shake plans.
                        </p>
                    </div>
                </div>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3">
                <div className="flex items-center gap-3">
                    <Switch checked={!grantsCredits} onCheckedChange={(v) => setGrantsCredits(!v)} />
                    <div className="min-w-0">
                        <Label className="block font-bold text-rose-900">🚫 This plan gives no shake credits</Label>
                        <p className="text-[11px] text-rose-700 leading-snug mt-0.5">
                            For access-only memberships. Leave OFF for normal plans. Without this, a plan with the credit box left at 0 falls back to the duration — a 30-day plan would quietly hand out 30 shakes.
                        </p>
                    </div>
                </div>
            </div>
            <Button type="submit" disabled={isLoading || !name} className="w-full">{isLoading ? "Saving..." : "Save Plan"}</Button>
        </form>
    );
}
