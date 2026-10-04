import { useEffect, useState } from "react";
import { Gift, Heart } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useBirthdayAnniversaryCheck } from "@/hooks/useMemberFeatures";

export default function BirthdayPopup() {
    const { peopleToCelebrate, dismiss } = useBirthdayAnniversaryCheck();
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (peopleToCelebrate) {
            setOpen(true);
            // Auto close after 10s
            const timer = setTimeout(() => {
                setOpen(false);
                dismiss();
            }, 10000);
            return () => clearTimeout(timer);
        }
    }, [peopleToCelebrate]);

    if (!peopleToCelebrate) return null;

    const handleClose = () => {
        setOpen(false);
        dismiss();
    };

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
            <DialogContent className="max-w-md bg-white p-6 overflow-hidden rounded-3xl border-none shadow-2xl">
                <div className="absolute -top-10 -left-10 w-32 h-32 bg-pink-100 rounded-full blur-3xl opacity-50 pointer-events-none"></div>
                <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-violet-100 rounded-full blur-3xl opacity-50 pointer-events-none"></div>

                <div className="relative text-center space-y-6">
                    <div className="text-4xl">🎉</div>

                    <div>
                        <h2 className="text-2xl font-black text-slate-900 mb-1">Time to Celebrate!</h2>
                        <p className="text-sm text-slate-500">People in your network have special days today.</p>
                    </div>

                    <div className="space-y-4 text-left">
                        {peopleToCelebrate.birthdays.length > 0 && (
                            <div className="bg-pink-50 rounded-2xl p-4 border border-pink-100">
                                <h3 className="text-sm font-bold text-pink-800 flex items-center gap-2 mb-3">
                                    <Gift className="w-4 h-4" /> Today's Birthdays
                                </h3>
                                <div className="space-y-2">
                                    {peopleToCelebrate.birthdays.map(u => (
                                        <div key={u.id} className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-white border border-pink-200 flex items-center justify-center font-bold text-pink-700 text-xs overflow-hidden">
                                                {u.photo ? <img src={u.photo} className="w-full h-full object-cover" /> : u.name[0]}
                                            </div>
                                            <span className="text-sm font-medium text-pink-900">{u.name}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {peopleToCelebrate.anniversaries.length > 0 && (
                            <div className="bg-violet-50 rounded-2xl p-4 border border-violet-100">
                                <h3 className="text-sm font-bold text-violet-800 flex items-center gap-2 mb-3">
                                    <Heart className="w-4 h-4 fill-violet-800" /> Today's Anniversaries
                                </h3>
                                <div className="space-y-2">
                                    {peopleToCelebrate.anniversaries.map(u => (
                                        <div key={u.id} className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-white border border-violet-200 flex items-center justify-center font-bold text-violet-700 text-xs overflow-hidden">
                                                {u.photo ? <img src={u.photo} className="w-full h-full object-cover" /> : u.name[0]}
                                            </div>
                                            <span className="text-sm font-medium text-violet-900">{u.name}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <Button onClick={handleClose} className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded-xl">
                        Close
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
