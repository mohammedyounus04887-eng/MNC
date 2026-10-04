import { useState } from "react";
import { CLUB_INFO, loyaltyConfig } from "@/data/mockData";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Settings, Home, Percent, Package, Star, CreditCard, Save, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function SettingsPage() {
  const [gst, setGst] = useState(5);
  const [bronze, setBronze] = useState(1500);
  const [silver, setSilver] = useState(2500);
  const [gold, setGold] = useState(4000);
  const [cash, setCash] = useState(true);
  const [upi, setUpi] = useState(true);
  const [card, setCard] = useState(true);
  const [saving, setSaving] = useState(false);

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      toast.success("Configuration updated successfully!");
    }, 1500);
  };

  return (
    <div className="space-y-8 animate-fade-in pb-20 max-w-4xl">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-4xl font-black text-wellness-forest tracking-tight">System Preferences</h2>
          <p className="text-primary font-black uppercase tracking-widest text-xs mt-1">Global Club Configuration</p>
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="btn-premium bg-primary text-white h-12 px-8 shadow-premium"
        >
          {saving ? 'Syncing...' : <><Save className="w-4 h-4 mr-2" /> Commit Changes</>}
        </Button>
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        <div className="space-y-8">
          {/* Club Details */}
          <section className="premium-card bg-white border-none shadow-premium space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                <Home className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-black text-wellness-forest">Identity & Location</h3>
            </div>
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest ml-4">Enterprise Name</Label>
                <Input defaultValue={CLUB_INFO.name} className="premium-input h-12" />
              </div>
              <div className="grid gap-2">
                <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest ml-4">Branch Detail</Label>
                <Input defaultValue={CLUB_INFO.clubName} className="premium-input h-12" />
              </div>
              <div className="grid gap-2">
                <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest ml-4">Facility Address</Label>
                <Input defaultValue={CLUB_INFO.address} className="premium-input h-12" />
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest ml-4">GSTIN</Label>
                  <Input defaultValue={CLUB_INFO.gstin} className="premium-input h-12" />
                </div>
                <div className="grid gap-2">
                  <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest ml-4">Contact</Label>
                  <Input defaultValue={CLUB_INFO.phone} className="premium-input h-12" />
                </div>
              </div>
            </div>
          </section>

          {/* GST */}
          <section className="premium-card bg-wellness-sage/10 border-border space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-wellness-forest text-white flex items-center justify-center">
                  <Percent className="w-5 h-5" />
                </div>
                <h3 className="text-xl font-black text-wellness-forest">Taxation Level</h3>
              </div>
              <div className="flex items-center gap-4">
                <Input
                  type="number"
                  value={gst}
                  onChange={(e) => setGst(Number(e.target.value))}
                  className="w-24 premium-input h-12 text-center text-lg font-black"
                />
                <span className="font-black text-wellness-forest">%</span>
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-8">
          {/* Package Pricing */}
          <section className="premium-card bg-white border-none shadow-premium space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent">
                <Package className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-black text-wellness-forest">Membership Yield</h3>
            </div>
            <div className="grid gap-6">
              {[
                { label: 'Bronze Plan', val: bronze, set: setBronze, color: 'border-orange-200' },
                { label: 'Silver Plan', val: silver, set: setSilver, color: 'border-slate-200' },
                { label: 'Gold Plan', val: gold, set: setGold, color: 'border-amber-200' }
              ].map((p, i) => (
                <div key={i} className={`p-4 rounded-3xl border ${p.color} bg-wellness-cream/20 flex items-center justify-between`}>
                  <Label className="text-xs font-black text-wellness-forest uppercase tracking-widest">{p.label}</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground font-black">₹</span>
                    <Input
                      type="number"
                      value={p.val}
                      onChange={(e) => p.set(Number(e.target.value))}
                      className="w-32 bg-white border-none text-right font-black text-lg focus-visible:ring-0"
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Payment Modes */}
          <section className="premium-card bg-white border-none shadow-premium space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500">
                <CreditCard className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-black text-wellness-forest">Payment Gateways</h3>
            </div>
            <div className="space-y-2">
              {[
                { label: 'Physical Cash', checked: cash, set: setCash },
                { label: 'UPI / Digital', checked: upi, set: setUpi },
                { label: 'Card Terminals', checked: card, set: setCard }
              ].map((p, i) => (
                <div key={i} className="flex items-center justify-between p-4 rounded-2xl hover:bg-wellness-mint/10 transition-colors">
                  <Label className="font-bold text-wellness-forest">{p.label}</Label>
                  <Switch checked={p.checked} onCheckedChange={p.set} className="data-[state=checked]:bg-primary" />
                </div>
              ))}
            </div>
          </section>

          {/* Loyalty Config */}
          <section className="premium-card bg-wellness-forest text-white border-none space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                <Star className="w-5 h-5 text-primary fill-primary" />
              </div>
              <h3 className="text-xl font-black">Token Economy</h3>
            </div>
            <div className="space-y-3">
              {loyaltyConfig.map((l, i) => (
                <div key={i} className="flex items-center justify-between bg-white/5 rounded-2xl p-4 border border-white/10">
                  <span className="text-xs font-bold text-white/80">{l.activity}</span>
                  <div className="flex items-center gap-2">
                    <Input className="w-20 h-9 bg-transparent border-white/20 text-center font-black" type="number" defaultValue={l.points} />
                    <span className="text-[10px] font-black text-primary uppercase">PTS</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
