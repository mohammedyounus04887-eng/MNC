import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Eye, Edit, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import MemberForm, { type MemberFormValues } from "@/components/owner/MemberForm";
import { useClubMembers, useAddMember, useDeactivateMember } from "@/hooks/useOwner";
import { useClubContext } from "@/lib/clubDetection";
import MemberDetailModal from "@/components/owner/MemberDetailModal";

type FilterTab = "all" | "active" | "gold" | "silver" | "bronze" | "expired";

export default function MembersPage() {
    const navigate = useNavigate();
    const { toast } = useToast();
    const { club } = useClubContext();
    const { data: members, isLoading } = useClubMembers();
    const addMember = useAddMember();
    const deactivate = useDeactivateMember();
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState<FilterTab>("all");
    const [sheetOpen, setSheetOpen] = useState(false);
    const [deactivateId, setDeactivateId] = useState<string | null>(null);
    const [detailMember, setDetailMember] = useState<any | null>(null);

    const filtered = useMemo(() => {
        if (!members) return [];
        let list = members;
        if (filter === "active") list = list.filter((m) => m.status === "active");
        else if (filter === "expired") list = list.filter((m) => m.status === "expired" || m.status === "paused");
        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter((m) => m.name.toLowerCase().includes(q) || m.phone.includes(q));
        }
        return list;
    }, [members, search, filter]);

    const handleAdd = async (data: MemberFormValues) => {
        try {
            await addMember.mutateAsync({
                name: data.name, phone: data.phone, email: data.email,
                dob: data.dob ? new Date(data.dob) : null,
                anniversary: data.anniversary ? new Date(data.anniversary) : null,
                referredBy: data.referredBy || null,
            });
            toast({ title: "Member added!", description: `${data.name} has been registered.` });
            setSheetOpen(false);
        } catch (err: any) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    };

    const tierColor: Record<string, string> = {
        gold: "bg-amber-100 text-amber-800 border-amber-200",
        silver: "bg-slate-100 text-slate-800 border-slate-200",
        bronze: "bg-orange-100 text-orange-800 border-orange-200",
    };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-black text-wellness-forest">Members</h1>
                    <Badge variant="secondary" className="text-xs">{members?.length || 0}</Badge>
                </div>
                <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
                    <SheetTrigger asChild>
                        <Button className="gap-2"><Plus className="w-4 h-4" /> Add Member</Button>
                    </SheetTrigger>
                    <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
                        <SheetHeader><SheetTitle>Add New Member</SheetTitle></SheetHeader>
                        <div className="mt-6">
                            <MemberForm mode="add" onSubmit={handleAdd} isLoading={addMember.isPending} />
                        </div>
                    </SheetContent>
                </Sheet>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input placeholder="Search by name or phone…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
                </div>
                <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterTab)}>
                    <TabsList className="flex-wrap">
                        <TabsTrigger value="all">All</TabsTrigger>
                        <TabsTrigger value="active">Active</TabsTrigger>
                        <TabsTrigger value="gold">Gold</TabsTrigger>
                        <TabsTrigger value="silver">Silver</TabsTrigger>
                        <TabsTrigger value="bronze">Bronze</TabsTrigger>
                        <TabsTrigger value="expired">Expired</TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            {isLoading ? (
                <div className="space-y-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
            ) : filtered.length === 0 ? (
                <p className="text-center text-muted-foreground py-12 text-sm">No members match your search.</p>
            ) : (
                <div className="space-y-2">
                    {filtered.map((m) => (
                        <div key={m.id} className="flex items-center gap-4 p-4 rounded-xl border bg-white hover:shadow-md transition-shadow">
                            <Avatar className="h-10 w-10">
                                {m.photo ? <AvatarImage src={m.photo} loading="lazy" /> : null}
                                <AvatarFallback className="bg-violet-100 text-violet-700 font-bold text-sm">{m.name[0]}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-4 gap-1 items-center">
                                <div>
                                    <p className="text-sm font-semibold truncate">{m.name}</p>
                                    <p className="text-xs text-muted-foreground">{m.phone}</p>
                                </div>
                                <div className="hidden sm:block">
                                    <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">{(m as any).shakeCredits ?? 0} credits</Badge>
                                </div>
                                <div className="hidden sm:block">
                                    <p className="text-xs text-muted-foreground">
                                        {((m as any).shakeCredits ?? 0) > 0 ? `${(m as any).shakeCredits} credits left` : "No credits"}
                                    </p>
                                </div>
                                <div className="hidden sm:block">
                                    <Badge variant={m.status === "active" ? "outline" : "destructive"} className={m.status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700 text-xs" : "text-xs"}>
                                        {m.status}
                                    </Badge>
                                </div>
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setDetailMember(m)}><Eye className="w-4 h-4" /></Button>
                                <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" onClick={() => setDeactivateId(m.id)}><UserX className="w-4 h-4" /></Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <AlertDialog open={!!deactivateId} onOpenChange={() => setDeactivateId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Deactivate member?</AlertDialogTitle>
                        <AlertDialogDescription>This will pause their membership. They can be reactivated later.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => { if (deactivateId) { deactivate.mutate(deactivateId); setDeactivateId(null); } }}>Deactivate</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {detailMember && club?.id && (
                <MemberDetailModal
                    member={detailMember}
                    clubId={club.id}
                    onClose={() => setDetailMember(null)}
                />
            )}
        </div>
    );
}
