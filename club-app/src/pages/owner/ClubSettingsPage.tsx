import { useState, useEffect, useCallback } from "react";
import { Eye, EyeOff, Save, Trash2, Plus, Megaphone, Fingerprint, Copy, CheckCircle, XCircle, Loader2, Send, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useClubContext } from "@/lib/clubDetection";
import { useAuth } from "@/lib/auth";
import AnnouncementForm from "@/components/owner/AnnouncementForm";
import InventoryUpdateComponent from "@/components/inventory/InventoryUpdate";
import VirtualProductSetsComponent from "@/components/inventory/VirtualProductSets";
import GrowLineIntegrationPanel from "@/components/owner/GrowLineIntegrationPanel";
import {
    useAllProducts, useSetTodaysSpecial,
    useAnnouncements, useCreateAnnouncement, useDeleteAnnouncement,
    useUpdateClubSettings,
} from "@/hooks/useOwner";
import { doc, onSnapshot, collection, getDocs, setDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export default function ClubSettingsPage() {
    const { toast } = useToast();
    const { club } = useClubContext();
    const { firebaseUser } = useAuth();

    // Today's special
    const { data: products, isLoading: productsLoading } = useAllProducts();
    const setSpecial = useSetTodaysSpecial();
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [specialInit, setSpecialInit] = useState(false);
    if (products && !specialInit) {
        setSelectedIds(products.filter((p) => p.isAvailableToday).map((p) => p.id));
        setSpecialInit(true);
    }

    // Announcements
    const { data: announcements, isLoading: annLoading } = useAnnouncements();
    const createAnn = useCreateAnnouncement();
    const deleteAnn = useDeleteAnnouncement();
    const [annOpen, setAnnOpen] = useState(false);
    const [deleteAnnId, setDeleteAnnId] = useState<string | null>(null);

    // Kitchen PIN
    const [showPin, setShowPin] = useState(false);
    const [newPin, setNewPin] = useState("");
    // BTC coordinator PIN
    const [showBtcPin, setShowBtcPin] = useState(false);
    const [newBtcPin, setNewBtcPin] = useState("");
    const updateSettings = useUpdateClubSettings();

    // Club profile
    const [clubName, setClubName] = useState(club?.name || "");
    const [tagline, setTagline] = useState(club?.tagline || "");
    const [primaryColor, setPrimaryColor] = useState(club?.primaryColor || "#8B5CF6");

    // Referral Settings
    const [referralBonusCoins, setReferralBonusCoins] = useState(club?.referralBonusCoins ?? 50);

    // Weigh-in days
    const ALL_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
    const DAY_LABELS: Record<string, string> = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun" };
    const [weighInDays, setWeighInDays] = useState<string[]>((club as any)?.weighInDays ?? []);

    // UPI Accounts
    type UpiAccount = { id: string; app: string; number: string; holderName: string };
    const [upiAccounts, setUpiAccounts] = useState<UpiAccount[]>([]);
    const [upiForm, setUpiForm] = useState({ app: '', number: '', holderName: '' });
    const [upiSaving, setUpiSaving] = useState(false);

    // Sync UPI accounts and weigh-in days from club whenever club loads/changes.
    // Without this, useState's initializer only runs on first render — when
    // `club` is still null — so existing data never appears in the UI and the
    // user thinks "I can't add UPI accounts".
    useEffect(() => {
        if (!club) return;
        setUpiAccounts(((club as any).upiAccounts ?? []) as UpiAccount[]);
        setWeighInDays(((club as any).weighInDays ?? []) as string[]);
    }, [club]);

    const handleAddUpi = async () => {
        if (!club || !upiForm.app || !upiForm.number || !upiForm.holderName) return;
        setUpiSaving(true);
        const newAccount: UpiAccount = { id: Date.now().toString(), ...upiForm };
        const updated = [...upiAccounts, newAccount];
        try {
            await updateDoc(doc(db, 'clubs', club.id), { upiAccounts: updated });
            setUpiAccounts(updated);
            setUpiForm({ app: '', number: '', holderName: '' });
            toast({ title: 'UPI account added!' });
        } catch (e: any) {
            toast({ title: 'Error', description: e.message, variant: 'destructive' });
        }
        setUpiSaving(false);
    };

    const handleDeleteUpi = async (id: string) => {
        if (!club) return;
        const updated = upiAccounts.filter(u => u.id !== id);
        await updateDoc(doc(db, 'clubs', club.id), { upiAccounts: updated });
        setUpiAccounts(updated);
        toast({ title: 'UPI account removed' });
    };

    const toggleWeighDay = (day: string) => {
        setWeighInDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
    };

    const handleSaveWeighInDays = () => {
        if (!club) return;
        updateSettings.mutate({ clubId: club.id, data: { weighInDays } }, {
            onSuccess: () => toast({ title: "Weigh-in schedule saved!" }),
            onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
        });
    };

    const handleToggleProduct = (productId: string) => {
        const updated = selectedIds.includes(productId)
            ? selectedIds.filter((id) => id !== productId)
            : [...selectedIds, productId];
        setSelectedIds(updated);
        setSpecial.mutate(updated, {
            onSuccess: () => toast({ title: "Today's special updated!" }),
            onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
        });
    };

    const handleSavePin = () => {
        if (!club || newPin.length !== 4) return;
        updateSettings.mutate({ clubId: club.id, data: { kitchenPin: newPin } }, {
            onSuccess: () => { toast({ title: "Kitchen PIN updated!" }); setNewPin(""); },
            onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
        });
    };

    const handleSaveBtcPin = () => {
        if (!club || newBtcPin.length !== 4) return;
        updateSettings.mutate({ clubId: club.id, data: { btcPin: newBtcPin } }, {
            onSuccess: () => { toast({ title: "BTC PIN updated!" }); setNewBtcPin(""); },
            onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
        });
    };

    const handleSaveProfile = () => {
        if (!club) return;
        updateSettings.mutate({ clubId: club.id, data: { name: clubName, tagline, primaryColor } }, {
            onSuccess: () => toast({ title: "Club profile updated!" }),
            onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
        });
    };

    const handleSaveReferralSettings = () => {
        if (!club) return;
        updateSettings.mutate({ clubId: club.id, data: { referralBonusCoins } }, {
            onSuccess: () => toast({ title: "Referral settings updated!" }),
            onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
        });
    };

    return (
        <div className="space-y-6 animate-fade-in max-w-4xl">
            <h1 className="text-2xl font-black text-wellness-forest">Club Settings</h1>

            <Tabs defaultValue="special">
                <TabsList className="flex-wrap">
                    <TabsTrigger value="special">Today's Special</TabsTrigger>
                    <TabsTrigger value="announcements">Announcements</TabsTrigger>
                    <TabsTrigger value="kitchen">Kitchen PIN</TabsTrigger>
                    <TabsTrigger value="btc">BTC PIN</TabsTrigger>
                    <TabsTrigger value="profile">Club Profile</TabsTrigger>
                    <TabsTrigger value="referrals">Referrals</TabsTrigger>
                    <TabsTrigger value="weighin">Weigh-in</TabsTrigger>
                    <TabsTrigger value="upi">UPI Accounts</TabsTrigger>
                    <TabsTrigger value="growline">GrowLine</TabsTrigger>
                    <TabsTrigger value="inv_update">Update Inventory</TabsTrigger>
                    <TabsTrigger value="virtual_sets">Virtual Sets</TabsTrigger>
                </TabsList>

                {/* Today's Special */}
                <TabsContent value="special" className="mt-6 space-y-3">
                    {productsLoading ? (
                        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
                    ) : products && products.length > 0 ? (
                        products.map((p) => (
                            <div key={p.id} className={`flex items-center justify-between p-4 rounded-xl border transition-all ${selectedIds.includes(p.id) ? "bg-emerald-50 border-emerald-200" : "bg-white"}`}>
                                <div>
                                    <p className="text-sm font-semibold">{p.name}</p>
                                    <p className="text-xs text-muted-foreground">{p.price} • Stock: {p.stock}</p>
                                </div>
                                <Switch
                                    checked={selectedIds.includes(p.id)}
                                    onCheckedChange={() => handleToggleProduct(p.id)}
                                    disabled={setSpecial.isPending}
                                />
                            </div>
                        ))
                    ) : (
                        <p className="text-center text-muted-foreground text-sm py-8">No products in this club</p>
                    )}
                </TabsContent>

                {/* Announcements */}
                <TabsContent value="announcements" className="mt-6 space-y-4">
                    <div className="flex justify-end">
                        <Button onClick={() => setAnnOpen(true)} className="gap-2"><Plus className="w-4 h-4" /> New Announcement</Button>
                    </div>
                    {annLoading ? (
                        <Skeleton className="h-24 rounded-xl" />
                    ) : announcements && announcements.filter((a) => a.isActive).length > 0 ? (
                        <div className="space-y-2">
                            {announcements.filter((a) => a.isActive).map((a) => (
                                <div key={a.id} className="flex items-start justify-between p-4 rounded-xl border bg-white">
                                    <div className="flex items-start gap-3">
                                        <Megaphone className="w-5 h-5 text-violet-500 mt-0.5" />
                                        <div>
                                            <p className="text-sm font-semibold">{a.title}</p>
                                            <p className="text-xs text-muted-foreground mt-1">{a.message}</p>
                                            <p className="text-xs text-muted-foreground mt-2">{a.createdAt?.toDate?.().toLocaleDateString()}</p>
                                        </div>
                                    </div>
                                    <Button size="icon" variant="ghost" className="text-red-500 h-8 w-8" onClick={() => setDeleteAnnId(a.id)}><Trash2 className="w-4 h-4" /></Button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-center text-muted-foreground text-sm py-8">No announcements</p>
                    )}

                    <Dialog open={annOpen} onOpenChange={setAnnOpen}>
                        <DialogContent><DialogHeader><DialogTitle>New Announcement</DialogTitle></DialogHeader>
                            <AnnouncementForm
                                onSubmit={(data) => {
                                    createAnn.mutate({ ...data, postedBy: firebaseUser?.uid || "" }, {
                                        onSuccess: () => { toast({ title: "Announcement posted!" }); setAnnOpen(false); },
                                        onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
                                    });
                                }}
                                isLoading={createAnn.isPending}
                            />
                        </DialogContent>
                    </Dialog>

                    <AlertDialog open={!!deleteAnnId} onOpenChange={() => setDeleteAnnId(null)}>
                        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete announcement?</AlertDialogTitle>
                            <AlertDialogDescription>This will hide the announcement from all users.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => { if (deleteAnnId) { deleteAnn.mutate(deleteAnnId); setDeleteAnnId(null); } }}>Delete</AlertDialogAction></AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </TabsContent>

                {/* Kitchen PIN */}
                <TabsContent value="kitchen" className="mt-6">
                    <div className="max-w-sm bg-white rounded-2xl border p-6 space-y-4">
                        <div className="space-y-2">
                            <Label>Current Kitchen PIN</Label>
                            <div className="flex items-center gap-2">
                                <Input value={showPin ? (club?.kitchenPin || "—") : "••••"} readOnly className="text-center text-lg font-mono tracking-widest" />
                                <Button size="icon" variant="ghost" onClick={() => setShowPin(!showPin)}>{showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</Button>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Change PIN</Label>
                            <Input value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="New 4-digit PIN" className="text-center" maxLength={4} />
                        </div>
                        <Button onClick={handleSavePin} disabled={newPin.length !== 4 || updateSettings.isPending} className="w-full">
                            <Save className="w-4 h-4 mr-2" /> {updateSettings.isPending ? "Saving…" : "Save PIN"}
                        </Button>
                    </div>
                </TabsContent>

                {/* BTC Coordinator PIN */}
                <TabsContent value="btc" className="mt-6">
                    <div className="max-w-sm bg-white rounded-2xl border p-6 space-y-4">
                        <div>
                            <h3 className="font-bold text-base text-amber-900">🏆 BTC Coordinator PIN</h3>
                            <p className="text-xs text-muted-foreground mt-1">
                                The 4-digit PIN coordinators enter at <code>/btc</code> to access the Body Transformation Challenge dashboard.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label>Current BTC PIN</Label>
                            <div className="flex items-center gap-2">
                                <Input value={showBtcPin ? ((club as any)?.btcPin || "—") : "••••"} readOnly className="text-center text-lg font-mono tracking-widest" />
                                <Button size="icon" variant="ghost" onClick={() => setShowBtcPin(!showBtcPin)}>{showBtcPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</Button>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Change PIN</Label>
                            <Input value={newBtcPin} onChange={(e) => setNewBtcPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="New 4-digit PIN" className="text-center" maxLength={4} />
                        </div>
                        <Button onClick={handleSaveBtcPin} disabled={newBtcPin.length !== 4 || updateSettings.isPending} className="w-full bg-amber-600 hover:bg-amber-700">
                            <Save className="w-4 h-4 mr-2" /> {updateSettings.isPending ? "Saving…" : "Save BTC PIN"}
                        </Button>
                    </div>
                </TabsContent>

                {/* Club Profile */}
                <TabsContent value="profile" className="mt-6">
                    <div className="max-w-lg bg-white rounded-2xl border p-6 space-y-4">
                        <div className="space-y-2"><Label>Club Name</Label><Input value={clubName} onChange={(e) => setClubName(e.target.value)} /></div>
                        <div className="space-y-2"><Label>Tagline</Label><Input value={tagline} onChange={(e) => setTagline(e.target.value)} /></div>
                        <div className="space-y-2">
                            <Label>Domain (read-only)</Label>
                            <Input value={club?.domain || ""} readOnly className="bg-gray-50" />
                        </div>
                        <div className="flex items-center gap-3">
                            <Label>Primary Color</Label>
                            <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="w-10 h-10 rounded-lg cursor-pointer border-0" />
                        </div>
                        <Button onClick={handleSaveProfile} disabled={updateSettings.isPending} className="w-full">
                            <Save className="w-4 h-4 mr-2" /> {updateSettings.isPending ? "Saving…" : "Save Profile"}
                        </Button>
                    </div>
                </TabsContent>

                {/* Referral Settings */}
                <TabsContent value="referrals" className="mt-6">
                    <div className="max-w-lg bg-white rounded-2xl border p-6 space-y-4">
                        <div className="space-y-2">
                            <Label>Referral Bonus Coins</Label>
                            <Input
                                type="number"
                                value={referralBonusCoins}
                                onChange={(e) => setReferralBonusCoins(Number(e.target.value))}
                                min={0}
                            />
                            <p className="text-xs text-muted-foreground mt-2">
                                Members currently earn {referralBonusCoins} {club?.currencyName || "coins"} for each successful referral.
                            </p>
                        </div>
                        <Button onClick={handleSaveReferralSettings} disabled={updateSettings.isPending} className="w-full">
                            <Save className="w-4 h-4 mr-2" /> {updateSettings.isPending ? "Saving…" : "Save Settings"}
                        </Button>
                    </div>
                </TabsContent>

                {/* Weigh-in Schedule */}
                <TabsContent value="weighin" className="mt-6">
                    <div className="max-w-lg bg-white rounded-2xl border p-6 space-y-4">
                        <div>
                            <h3 className="text-sm font-bold text-slate-900">Weigh-in Days</h3>
                            <p className="text-xs text-muted-foreground mt-1">Select which days members do weigh-in</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {ALL_DAYS.map(day => (
                                <button
                                    key={day}
                                    onClick={() => toggleWeighDay(day)}
                                    className="px-4 py-2 rounded-full text-sm font-bold transition-all"
                                    style={{
                                        backgroundColor: weighInDays.includes(day) ? "#2d9653" : "transparent",
                                        color: weighInDays.includes(day) ? "#fff" : "#6b7280",
                                        border: weighInDays.includes(day) ? "2px solid #2d9653" : "2px solid #d1d5db",
                                    }}
                                >
                                    {DAY_LABELS[day]}
                                </button>
                            ))}
                        </div>
                        {weighInDays.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                                Members weigh in on: {weighInDays.map(d => DAY_LABELS[d]).join(", ")}
                            </p>
                        )}
                        <Button onClick={handleSaveWeighInDays} disabled={updateSettings.isPending} className="w-full" style={{ backgroundColor: "#2d9653" }}>
                            <Save className="w-4 h-4 mr-2" /> {updateSettings.isPending ? "Saving…" : "Save Schedule"}
                        </Button>
                    </div>
                </TabsContent>
                {/* UPI Accounts */}
                <TabsContent value="upi" className="mt-6 space-y-6">
                    <div>
                        <h2 className="text-lg font-bold flex items-center gap-2"><Smartphone className="w-5 h-5 text-emerald-600" /> UPI Payment Accounts</h2>
                        <p className="text-sm text-muted-foreground mt-1">Add UPI accounts used at reception. Staff will select one when a member pays via UPI.</p>
                    </div>

                    {/* Existing accounts */}
                    <div className="space-y-2">
                        {upiAccounts.length === 0 && (
                            <p className="text-sm text-muted-foreground text-center py-6 border border-dashed rounded-xl">No UPI accounts added yet.</p>
                        )}
                        {upiAccounts.map(u => (
                            <div key={u.id} className="flex items-center justify-between p-4 rounded-xl border bg-white">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                                        <Smartphone className="w-5 h-5 text-emerald-600" />
                                    </div>
                                    <div>
                                        <p className="font-semibold text-sm">{u.app}</p>
                                        <p className="text-xs text-muted-foreground">{u.number} · {u.holderName}</p>
                                    </div>
                                </div>
                                <Button variant="ghost" size="icon" className="text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => handleDeleteUpi(u.id)}>
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        ))}
                    </div>

                    {/* Add new account */}
                    <div className="border rounded-xl p-5 space-y-4 bg-slate-50">
                        <h3 className="font-semibold text-sm">Add New UPI Account</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs">UPI Name</Label>
                                <Input placeholder="e.g. PhonePe, GPay, Paytm" value={upiForm.app} onChange={e => setUpiForm(f => ({ ...f, app: e.target.value }))} />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">UPI ID</Label>
                                <Input placeholder="e.g. 9876543210@ybl" value={upiForm.number} onChange={e => setUpiForm(f => ({ ...f, number: e.target.value }))} />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Mobile Number</Label>
                                <Input placeholder="e.g. 9876543210" value={upiForm.holderName} onChange={e => setUpiForm(f => ({ ...f, holderName: e.target.value }))} />
                            </div>
                        </div>
                        <Button onClick={handleAddUpi} disabled={upiSaving || !upiForm.app || !upiForm.number || !upiForm.holderName} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2">
                            {upiSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Plus className="w-4 h-4" /> Add Account</>}
                        </Button>
                    </div>
                </TabsContent>

                <TabsContent value="growline" className="mt-6">
                    <GrowLineIntegrationPanel />
                </TabsContent>

                {/* Update Inventory */}
                <TabsContent value="inv_update" className="mt-6">
                    {club && <InventoryUpdateComponent clubId={club.id} />}
                </TabsContent>

                {/* Virtual Product Sets */}
                <TabsContent value="virtual_sets" className="mt-6">
                    {club && <VirtualProductSetsComponent clubId={club.id} />}
                </TabsContent>

            </Tabs>
        </div>
    );
}
