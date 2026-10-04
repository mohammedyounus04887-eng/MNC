import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Edit, ToggleLeft, ToggleRight, Clock, Coins } from "lucide-react";
import type { MembershipPlan } from "@/types/firestore";
import { useClubContext } from "@/lib/clubDetection";

interface Props {
    plan: MembershipPlan;
    onEdit: () => void;
    onToggle: () => void;
    isToggling: boolean;
}

export default function PlanCard({ plan, onEdit, onToggle, isToggling }: Props) {
    const { club } = useClubContext();

    return (
        <div
            className={`rounded-2xl border p-6 space-y-4 transition-all hover:shadow-lg ${plan.isActive ? "bg-white border-border" : "bg-gray-50 border-gray-200 opacity-70"
                }`}
        >
            <div className="flex items-start justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: plan.color || "#8B5CF6" }} />
                        <h3 className="text-lg font-bold">{plan.name}</h3>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                        <Badge variant={plan.isActive ? "outline" : "secondary"} className="text-xs">
                            {plan.isActive ? "Active" : "Inactive"}
                        </Badge>
                        {(plan as any).luckyDipEligible && (
                            <Badge className="text-[10px] bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200">
                                🎲 Lucky Dip
                            </Badge>
                        )}
                    </div>
                </div>
                <div className="text-right">
                    <p className="text-2xl font-bold">{plan.price}</p>
                    <p className="text-xs text-muted-foreground">{club?.currencyName}</p>
                </div>
            </div>

            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1"><Clock className="w-4 h-4" /> {plan.durationDays ?? 0} days</div>
                <div className="flex items-center gap-1"><Coins className="w-4 h-4" /> {plan.price} {club?.currencyName}</div>
            </div>

            {plan.benefits && plan.benefits.length > 0 && (
                <ul className="space-y-1">
                    {plan.benefits.map((b, i) => (
                        <li key={i} className="text-xs text-muted-foreground flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            {b}
                        </li>
                    ))}
                </ul>
            )}

            <div className="flex gap-2 pt-2">
                <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={onEdit}>
                    <Edit className="w-3.5 h-3.5 mr-1" /> Edit
                </Button>
                <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs"
                    disabled={isToggling}
                    onClick={onToggle}
                >
                    {plan.isActive ? <ToggleRight className="w-4 h-4 mr-1 text-emerald-500" /> : <ToggleLeft className="w-4 h-4 mr-1" />}
                    {plan.isActive ? "Active" : "Inactive"}
                </Button>
            </div>
        </div>
    );
}
