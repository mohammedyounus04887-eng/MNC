import { useState } from "react";
import { Eye, UserPlus, ArrowLeft, Fingerprint, Star, Clock, Heart, ShieldCheck, ChevronRight, Search } from "lucide-react";
import { volunteers, Volunteer } from "@/data/mockData";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function Volunteers() {
  const [selectedVol, setSelectedVol] = useState<Volunteer | null>(null);
  const [showBio, setShowBio] = useState(false);
  const [scanning, setScanning] = useState(false);

  const startScan = () => {
    setScanning(true);
    setTimeout(() => {
      setScanning(false);
    }, 3000);
  };

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      {!selectedVol ? (
        <>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-4xl font-black text-wellness-forest tracking-tight">Our Wellness Team</h2>
              <p className="text-primary font-black uppercase tracking-widest text-xs mt-1">Volunteer Community</p>
            </div>
            <Button className="btn-premium bg-primary text-white">
              <UserPlus className="w-4 h-4 mr-2" /> Recruit Volunteer
            </Button>
          </div>

          {/* Team Hero */}
          <div className="relative premium-card p-0 overflow-hidden border-none min-h-[300px] flex items-center">
            <div className="absolute inset-0 bg-gradient-to-r from-wellness-forest/90 to-transparent z-10" />
            <img src="https://images.unsplash.com/photo-1552664730-d307ca884978?q=80&w=1200" alt="Team" className="absolute inset-0 w-full h-full object-cover" />
            <div className="relative z-20 p-8 md:p-12 max-w-lg space-y-4">
              <div className="bg-primary/20 backdrop-blur-md px-4 py-1.5 rounded-full inline-flex items-center gap-2 border border-white/20">
                <Star className="w-4 h-4 text-accent fill-accent" />
                <span className="text-white text-xs font-black uppercase tracking-widest">Community Focused</span>
              </div>
              <h3 className="text-4xl font-black text-white leading-tight">Empowering Lives Through Service</h3>
              <p className="text-white/80 font-bold leading-relaxed">Our volunteers are the backbone of Magic Nutrition Club, helping others achieve their wellness goals every day.</p>
            </div>
          </div>

          {/* Volunteers List */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {volunteers.map((v) => (
              <div key={v.id} className="premium-card group hover:border-primary/50 transition-all">
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 rounded-2xl overflow-hidden border border-border group-hover:scale-105 transition-transform">
                    <img src={`https://i.pravatar.cc/150?u=${v.id}`} alt={v.name} className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1">
                    <p className="text-[10px] font-black text-primary uppercase tracking-widest mb-1">{v.role}</p>
                    <h4 className="text-xl font-bold text-wellness-forest leading-tight mb-1">{v.name}</h4>
                    <p className="text-xs font-bold text-muted-foreground">{v.id}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-6 p-4 rounded-2xl bg-wellness-cream/50 border border-border">
                  <div className="text-center">
                    <p className="text-xl font-black text-wellness-forest">{v.totalDaysWorked}</p>
                    <p className="text-[10px] font-black text-muted-foreground uppercase">Days</p>
                  </div>
                  <div className="text-center border-l border-border">
                    <p className="text-xl font-black text-primary">{v.totalHoursThisMonth}</p>
                    <p className="text-[10px] font-black text-muted-foreground uppercase">Hrs/mo</p>
                  </div>
                </div>
                <Button
                  onClick={() => setSelectedVol(v)}
                  className="w-full mt-6 btn-premium bg-secondary/30 text-primary hover:bg-primary hover:text-white h-11"
                >
                  View Performance
                </Button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <button
            onClick={() => setSelectedVol(null)}
            className="inline-flex items-center gap-2 text-sm font-black text-primary hover:translate-x-[-4px] transition-transform"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Team
          </button>

          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1 space-y-6">
              <div className="premium-card text-center space-y-4">
                <div className="w-32 h-32 rounded-[40px] border-4 border-white shadow-premium overflow-hidden mx-auto">
                  <img src={`https://i.pravatar.cc/200?u=${selectedVol.id}`} alt={selectedVol.name} className="w-full h-full object-cover" />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-wellness-forest">{selectedVol.name}</h3>
                  <p className="text-primary font-black uppercase tracking-widest text-xs mt-1">{selectedVol.id}</p>
                </div>
                <div className="bg-wellness-mint p-4 rounded-2xl border border-primary/10">
                  <p className="text-primary text-xs font-black uppercase tracking-widest">{selectedVol.role}</p>
                  <p className="text-wellness-forest font-bold text-sm mt-1">{selectedVol.phone}</p>
                </div>
                <div className="flex gap-2">
                  <Button className="flex-1 btn-premium bg-primary text-white h-12">Edit Role</Button>
                  <Button
                    onClick={() => setShowBio(true)}
                    variant="outline"
                    className="btn-premium border-primary/20 text-primary h-12"
                  >
                    <Fingerprint className="w-5 h-5" />
                  </Button>
                </div>
              </div>

              <div className="premium-card space-y-4">
                <h4 className="text-sm font-black text-wellness-forest uppercase tracking-widest flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-primary" /> Key Stats
                </h4>
                <div className="space-y-3">
                  <div className="flex justify-between items-center p-3 rounded-xl bg-wellness-cream border border-border">
                    <span className="text-xs font-bold text-muted-foreground">Monthly Goal</span>
                    <span className="text-sm font-black text-wellness-forest">40 Hours</span>
                  </div>
                  <div className="flex justify-between items-center p-3 rounded-xl bg-wellness-cream border border-border">
                    <span className="text-xs font-bold text-muted-foreground">Rank</span>
                    <span className="text-sm font-black text-accent flex items-center gap-1"><Star className="w-3 h-3 fill-accent" /> Expert</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-2 space-y-6">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="premium-card bg-wellness-sage text-white border-none flex items-center gap-6">
                  <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center">
                    <Clock className="w-8 h-8" />
                  </div>
                  <div>
                    <p className="text-4xl font-black">{selectedVol.totalHoursThisMonth}</p>
                    <p className="text-white/60 font-black text-[10px] uppercase tracking-widest">Hours This Month</p>
                  </div>
                </div>
                <div className="premium-card bg-wellness-mint border-none shadow-soft flex items-center gap-6">
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <Heart className="w-8 h-8 text-primary" />
                  </div>
                  <div>
                    <p className="text-4xl font-black text-wellness-forest">{selectedVol.totalDaysWorked}</p>
                    <p className="text-muted-foreground font-black text-[10px] uppercase tracking-widest">Lifetime Days</p>
                  </div>
                </div>
              </div>

              <div className="premium-card p-0 overflow-hidden">
                <div className="p-6 border-b border-border bg-wellness-cream/20 font-black text-wellness-forest uppercase tracking-widest text-xs">
                  Attendance Log
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-wellness-sage/5 border-b border-border text-left">
                        <th className="px-6 py-4 text-[10px] font-black text-muted-foreground uppercase">Date</th>
                        <th className="px-6 py-4 text-[10px] font-black text-muted-foreground uppercase">Shift</th>
                        <th className="px-6 py-4 text-right text-[10px] font-black text-muted-foreground uppercase">Hours</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {selectedVol.attendance.map((a, i) => (
                        <tr key={i} className="hover:bg-wellness-mint/10 transition-colors">
                          <td className="px-6 py-4 text-sm font-bold text-wellness-forest">{a.date}</td>
                          <td className="px-6 py-4">
                            <span className="text-xs font-bold text-muted-foreground">{a.inTime} - {a.outTime}</span>
                          </td>
                          <td className="px-6 py-4 text-right text-sm font-black text-primary">
                            {a.totalHours}h
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <Dialog open={showBio} onOpenChange={setShowBio}>
        <DialogContent className="max-w-md rounded-[40px] p-0 overflow-hidden border-none shadow-premium">
          <div className="bg-wellness-forest p-12 text-center relative">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(102,187,106,0.15),transparent)] animate-pulse" />
            <div className="relative z-10 space-y-6">
              <div className="relative mx-auto w-32 h-32 flex items-center justify-center">
                <div className={`absolute inset-0 rounded-full border-2 border-primary/50 ${scanning ? 'animate-ping' : ''}`} />
                <Fingerprint className={`w-20 h-20 text-primary transition-all duration-500 ${scanning ? 'scale-110 blur-[1px]' : ''}`} />
                {scanning && (
                  <div className="absolute top-0 w-full h-1 bg-primary/50 animate-scan shadow-[0_0_15px_rgba(102,187,106,0.8)]" />
                )}
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-black text-white">{scanning ? 'Analyzing Biometrics...' : 'Verify Identity'}</h3>
                <p className="text-white/40 text-xs font-bold uppercase tracking-widest">{scanning ? 'Checking cloud registry' : 'Place finger on scanner'}</p>
              </div>
              <Button
                disabled={scanning}
                onClick={startScan}
                className="btn-premium bg-primary hover:bg-white hover:text-wellness-forest text-white w-full h-12"
              >
                {scanning ? 'System Processing' : 'Start Scan'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
