import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useClubMembers } from "@/hooks/useOwner";

const memberSchema = z.object({
    name: z.string().min(2, "Name is required"),
    phone: z.string().regex(/^\+?\d{10,15}$/, "Valid phone required"),
    email: z.string().email().optional().or(z.literal("")),
    dob: z.string().optional(),
    anniversary: z.string().optional(),
    referredBy: z.string().optional(),
    notes: z.string().optional(),
});

export type MemberFormValues = z.infer<typeof memberSchema>;

interface Props {
    defaultValues?: Partial<MemberFormValues>;
    onSubmit: (data: MemberFormValues) => void;
    isLoading: boolean;
    mode: "add" | "edit";
}

export default function MemberForm({ defaultValues, onSubmit, isLoading, mode }: Props) {
    const { data: existingMembers } = useClubMembers();
    const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<MemberFormValues>({
        resolver: zodResolver(memberSchema),
        defaultValues: { name: "", phone: "", email: "", dob: "", anniversary: "", referredBy: "", notes: "", ...defaultValues },
    });

    const [referralSearch, setReferralSearch] = useState("");
    const [referralOpen, setReferralOpen] = useState(false);
    const currentReferral = watch("referredBy");

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Full Name *</Label>
                    <Input {...register("name")} placeholder="John Doe" />
                    {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
                </div>
                <div className="space-y-2">
                    <Label>Phone *</Label>
                    <Input {...register("phone")} placeholder="+91 9999999999" />
                    {errors.phone && <p className="text-xs text-red-500">{errors.phone.message}</p>}
                </div>
            </div>
            <div className="space-y-2">
                <Label>Email</Label>
                <Input {...register("email")} placeholder="email@example.com" type="email" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Date of Birth</Label>
                    <Input {...register("dob")} type="date" />
                </div>
                <div className="space-y-2">
                    <Label>Anniversary</Label>
                    <Input {...register("anniversary")} type="date" />
                </div>
            </div>
            {mode === "add" && (
                <div className="space-y-2">
                    <Label>Referred By</Label>
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => { setReferralOpen(o => !o); setReferralSearch(""); }}
                            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                        >
                            <span className={currentReferral ? "text-foreground" : "text-muted-foreground"}>
                                {currentReferral
                                    ? (() => {
                                        const ref = (existingMembers || []).find((m: any) => m.id === currentReferral);
                                        return ref ? `${ref.name} — ${ref.phone}` : "Select referrer";
                                    })()
                                    : "Select referrer"}
                            </span>
                            <svg className="h-4 w-4 opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                        </button>
                        {referralOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setReferralOpen(false)} />
                                <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-64 flex flex-col">
                                    <div className="p-2 border-b">
                                        <input
                                            autoFocus
                                            type="text"
                                            placeholder="Search members…"
                                            value={referralSearch}
                                            onChange={e => setReferralSearch(e.target.value)}
                                            className="w-full h-8 px-2 text-sm rounded border border-input bg-background outline-none focus:ring-2 focus:ring-ring"
                                        />
                                    </div>
                                    <div className="overflow-y-auto flex-1 p-1">
                                        <button
                                            type="button"
                                            onClick={() => { setValue("referredBy", ""); setReferralOpen(false); }}
                                            className={`w-full text-left px-3 py-2 text-sm rounded hover:bg-accent ${!currentReferral ? "bg-accent font-semibold" : ""}`}
                                        >
                                            No referrer
                                        </button>
                                        {(existingMembers || [])
                                            .filter((m: any) => {
                                                if (!referralSearch.trim()) return true;
                                                const q = referralSearch.toLowerCase();
                                                return (m.name || "").toLowerCase().includes(q) || (m.phone || "").includes(q);
                                            })
                                            .map((m: any) => (
                                                <button
                                                    key={m.id}
                                                    type="button"
                                                    onClick={() => { setValue("referredBy", m.id); setReferralOpen(false); }}
                                                    className={`w-full text-left px-3 py-2 text-sm rounded hover:bg-accent ${currentReferral === m.id ? "bg-accent font-semibold" : ""}`}
                                                >
                                                    {m.name} — {m.phone}
                                                </button>
                                            ))
                                        }
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
            <div className="space-y-2">
                <Label>Notes / Allergies</Label>
                <Textarea {...register("notes")} placeholder="Any notes…" rows={3} />
            </div>
            <div className="flex justify-end pt-2">
                <Button type="submit" disabled={isLoading} className="px-8">
                    {isLoading ? (mode === "add" ? "Adding…" : "Saving…") : (mode === "add" ? "Add Member" : "Save Changes")}
                </Button>
            </div>
        </form>
    );
}
