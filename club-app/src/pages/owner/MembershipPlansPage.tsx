import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import PlanCard from "@/components/owner/PlanCard";
import PlanForm from "@/components/owner/PlanForm";
import { useMembershipPlans, useCreateMembershipPlan, useUpdateMembershipPlan } from "@/hooks/useOwner";

export default function MembershipPlansPage() {
    const { toast } = useToast();
    const { data: plans, isLoading } = useMembershipPlans();
    const createPlan = useCreateMembershipPlan();
    const updatePlan = useUpdateMembershipPlan();

    const [createOpen, setCreateOpen] = useState(false);
    const [editPlan, setEditPlan] = useState<any | null>(null);

    const handleCreate = async (data: any) => {
        try {
            await createPlan.mutateAsync(data);
            toast({ title: "Plan created!" });
            setCreateOpen(false);
        } catch (err: any) { toast({ title: "Error", description: err.message, variant: "destructive" }); }
    };

    const handleEdit = async (data: any) => {
        if (!editPlan) return;
        try {
            await updatePlan.mutateAsync({ planId: editPlan.id, data });
            toast({ title: "Plan updated!" });
            setEditPlan(null);
        } catch (err: any) { toast({ title: "Error", description: err.message, variant: "destructive" }); }
    };

    const handleToggle = async (plan: any) => {
        try {
            await updatePlan.mutateAsync({ planId: plan.id, data: { isActive: !plan.isActive } });
            toast({ title: plan.isActive ? "Plan deactivated" : "Plan activated" });
        } catch (err: any) { toast({ title: "Error", description: err.message, variant: "destructive" }); }
    };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-black text-wellness-forest">Membership Plans</h1>
                <Button onClick={() => setCreateOpen(true)} className="gap-2"><Plus className="w-4 h-4" /> Create Plan</Button>
            </div>

            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}</div>
            ) : plans && plans.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {plans.map((p) => (
                        <PlanCard key={p.id} plan={p} onEdit={() => setEditPlan(p)} onToggle={() => handleToggle(p)} isToggling={updatePlan.isPending} />
                    ))}
                </div>
            ) : (
                <div className="text-center py-16 border border-dashed rounded-2xl bg-white">
                    <p className="text-muted-foreground text-sm mb-4">No membership plans yet</p>
                    <Button onClick={() => setCreateOpen(true)}>Create First Plan</Button>
                </div>
            )}

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent><DialogHeader><DialogTitle>Create Plan</DialogTitle></DialogHeader>
                    <PlanForm onSubmit={handleCreate} isLoading={createPlan.isPending} />
                </DialogContent>
            </Dialog>

            <Dialog open={!!editPlan} onOpenChange={() => setEditPlan(null)}>
                <DialogContent><DialogHeader><DialogTitle>Edit Plan</DialogTitle></DialogHeader>
                    {editPlan && <PlanForm defaultValues={editPlan} onSubmit={handleEdit} isLoading={updatePlan.isPending} />}
                </DialogContent>
            </Dialog>
        </div>
    );
}
