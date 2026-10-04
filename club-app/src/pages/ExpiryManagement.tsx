import { useState } from "react";
import { members } from "@/data/mockData";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Send, MessageSquare, AlertCircle, Calendar, ShieldAlert, ArrowRight, CheckCircle2 } from "lucide-react";

type FilterType = "all" | "3days" | "7days" | "expired";

export default function ExpiryManagement() {
  const [filter, setFilter] = useState<FilterType>("all");
  const [showBulk, setShowBulk] = useState(false);
  const [sending, setSending] = useState(false);

  const filtered = members.filter(m => {
    if (filter === "3days") return m.daysLeft > 0 && m.daysLeft <= 3;
    if (filter === "7days") return m.daysLeft > 0 && m.daysLeft <= 7;
    if (filter === "expired") return m.daysLeft <= 0;
    return true;
  }).sort((a, b) => a.daysLeft - b.daysLeft);

  const startSending = () => {
    setSending(true);
    setTimeout(() => {
      setSending(false);
      setShowBulk(false);
    }, 2000);
  };

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-4xl font-black text-wellness-forest tracking-tight">Retention Desk</h2>
          <p className="text-primary font-black uppercase tracking-widest text-xs mt-1">Membership Lifecycle</p>
        </div>
        <Button onClick={() => setShowBulk(true)} className="btn-premium bg-primary text-white">
          <Send className="w-4 h-4 mr-2" /> Bulk Outreach
        </Button>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2 p-1.5 bg-wellness-sage/5 rounded-3xl w-fit border border-border/50">
        {([
          ["all", "Snapshot"],
          ["3days", "Critical (3d)"],
          ["7days", "Upcoming (7d)"],
          ["expired", "Past Due"]
        ] as const).map(([key, label]) => (
          <Button
            key={key}
            variant={filter === key ? "default" : "ghost"}
            onClick={() => setFilter(key)}
            className={`rounded-2xl px-6 py-2 h-auto font-black text-xs uppercase tracking-widest transition-all ${filter === key ? "bg-white text-wellness-forest shadow-premium border border-border" : "text-muted-foreground hover:text-primary"
              }`}
          >
            {label}
            {filter === key && <span className="ml-2 w-2 h-2 rounded-full bg-primary animate-pulse" />}
          </Button>
        ))}
      </div>

      <div className="premium-card p-0 overflow-hidden border-none shadow-premium bg-white">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-wellness-sage/5 border-b border-border text-left">
                <th className="px-8 py-5 text-[10px] font-black text-muted-foreground uppercase tracking-widest">Member Identity</th>
                <th className="px-6 py-5 text-[10px] font-black text-muted-foreground uppercase tracking-widest">Plan Type</th>
                <th className="px-6 py-5 text-[10px] font-black text-muted-foreground uppercase tracking-widest text-center">Expiry Timeline</th>
                <th className="px-6 py-5 text-[10px] font-black text-muted-foreground uppercase tracking-widest">Status</th>
                <th className="px-8 py-5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">Outreach</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filtered.map((m) => (
                <tr key={m.id} className="hover:bg-wellness-mint/20 transition-colors group">
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full border border-border overflow-hidden">
                        <img src={`https://i.pravatar.cc/100?u=${m.id}`} alt={m.name} className="w-full h-full object-cover" />
                      </div>
                      <div>
                        <p className="font-bold text-wellness-forest mb-0.5">{m.name}</p>
                        <p className="text-[10px] font-black text-muted-foreground">{m.id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${m.package === "Gold" ? "bg-amber-100 text-amber-700 border-amber-200" :
                        m.package === "Silver" ? "bg-slate-100 text-slate-700 border-slate-200" :
                          "bg-orange-100 text-orange-700 border-orange-200"
                      }`}>
                      {m.package}
                    </span>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex flex-col items-center">
                      <span className="text-sm font-black text-wellness-forest">{m.expiryDate}</span>
                      <div className="flex items-center gap-1 mt-1">
                        <Calendar className="w-3 h-3 text-muted-foreground" />
                        <span className="text-[10px] font-bold text-muted-foreground uppercase">Scheduled</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-2xl border ${m.daysLeft <= 0 ? "bg-destructive/10 text-destructive border-destructive/20" :
                        m.daysLeft <= 3 ? "bg-accent/10 text-accent border-accent/20" :
                          "bg-primary/10 text-primary border-primary/20"
                      }`}>
                      {m.daysLeft <= 0 ? <ShieldAlert className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                      <span className="text-xs font-black uppercase tracking-widest">
                        {m.daysLeft <= 0 ? 'Expired' : `${m.daysLeft} Days Left`}
                      </span>
                    </div>
                  </td>
                  <td className="px-8 py-5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="icon" className="rounded-full hover:bg-primary/10 hover:text-primary"><MessageSquare className="w-4 h-4" /></Button>
                      <Button size="sm" className="btn-premium bg-wellness-forest text-white h-9 px-4 text-[10px] uppercase font-black">Renew Member</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={showBulk} onOpenChange={setShowBulk}>
        <DialogContent className="max-w-md rounded-[40px] p-0 overflow-hidden border-none shadow-premium">
          <div className="p-8 space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Send className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="text-xl font-black text-wellness-forest">Outreach Campaign</h3>
                <p className="text-muted-foreground text-xs font-bold uppercase tracking-widest">SMS & In-App Notification</p>
              </div>
            </div>

            <div className="bg-wellness-cream p-6 rounded-3xl border border-border relative">
              <div className="absolute top-2 right-4 flex gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-slate-200" />
                <div className="w-1.5 h-1.5 rounded-full bg-slate-200" />
              </div>
              <p className="text-[10px] font-black text-primary uppercase mb-2">Message Preview</p>
              <p className="text-sm font-bold text-wellness-forest leading-relaxed">
                "Hi [Member Name], your Magic Nutrition Club membership is expiring in [X] days. Renew now to maintain your loyalty streak! 🌿"
              </p>
            </div>

            <div className="premium-card bg-wellness-sage/10 border-border p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 rounded-full border-2 border-primary" />
                <span className="text-xs font-black text-wellness-forest uppercase">{filtered.length} Recipients Identified</span>
              </div>
              <ArrowRight className="w-4 h-4 text-primary" />
            </div>

            <Button
              disabled={sending}
              onClick={startSending}
              className="w-full btn-premium bg-primary text-white h-14 text-lg font-black shadow-premium"
            >
              {sending ? 'Broadcasting...' : 'Signal All Members'}
            </Button>
          </div>

          {sending && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center p-8 text-center animate-fade-in">
              <div className="w-20 h-20 rounded-full border-4 border-primary border-t-transparent animate-spin mb-6" />
              <h4 className="text-2xl font-black text-wellness-forest">Broadcasting Signals</h4>
              <p className="text-muted-foreground font-bold mt-2">Delivering reminders to all selected members...</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
