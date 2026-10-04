import { Wifi, WifiOff, Fingerprint, RefreshCw, Play, Cpu, ShieldCheck, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function NFCSettings() {
  const [testing, setTesting] = useState<string | null>(null);

  const runTest = (device: string) => {
    setTesting(device);
    setTimeout(() => setTesting(null), 2000);
  };

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-4xl font-black text-wellness-forest tracking-tight">Hardware Control</h2>
          <p className="text-primary font-black uppercase tracking-widest text-xs mt-1">Peripheral Management</p>
        </div>
        <Button variant="outline" className="btn-premium border-primary/20 text-primary">
          <RefreshCw className={`w-4 h-4 mr-2 ${testing ? 'animate-spin' : ''}`} /> Global Reset
        </Button>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        {/* NFC Reader */}
        <div className="premium-card bg-white border-none shadow-premium relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
            <Wifi className="w-32 h-32" />
          </div>

          <div className="flex items-center gap-6 mb-8 relative z-10">
            <div className="relative">
              <div className="absolute -inset-2 bg-primary/20 rounded-2xl blur-lg animate-pulse" />
              <div className="w-16 h-16 rounded-[22px] bg-primary text-white flex items-center justify-center relative">
                <Wifi className="w-8 h-8" />
              </div>
            </div>
            <div>
              <h3 className="text-2xl font-black text-wellness-forest">NFC Reader</h3>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="text-[10px] font-black text-primary uppercase tracking-widest">Active & Syncing</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-8 relative z-10">
            <div className="p-4 rounded-2xl bg-wellness-cream border border-border">
              <p className="text-[10px] font-black text-muted-foreground uppercase mb-1">Last Activity</p>
              <p className="text-sm font-bold text-wellness-forest">07:45:22 AM</p>
            </div>
            <div className="p-4 rounded-2xl bg-wellness-cream border border-border">
              <p className="text-[10px] font-black text-muted-foreground uppercase mb-1">Signal Strength</p>
              <div className="flex gap-0.5 mt-1">
                {[1, 2, 3, 4].map(i => <div key={i} className="w-1.5 h-3 rounded-full bg-primary" />)}
                <div className="w-1.5 h-3 rounded-full bg-slate-200" />
              </div>
            </div>
          </div>

          <div className="space-y-3 relative z-10">
            <div className="flex justify-between items-center text-xs font-bold px-1">
              <span className="text-muted-foreground">Model Name</span>
              <span className="text-wellness-forest font-black">ACR122U-A9 Smart Card</span>
            </div>
            <div className="flex justify-between items-center text-xs font-bold px-1">
              <span className="text-muted-foreground">Firmware</span>
              <span className="text-wellness-forest font-black">v2.12.04</span>
            </div>
          </div>

          <div className="flex gap-3 mt-8 relative z-10">
            <Button
              disabled={!!testing}
              onClick={() => runTest('nfc')}
              className="flex-1 btn-premium bg-wellness-forest text-white h-12"
            >
              <Activity className={`w-4 h-4 mr-2 ${testing === 'nfc' ? 'animate-bounce' : ''}`} />
              {testing === 'nfc' ? 'Running Diagnostic...' : 'Test Signal'}
            </Button>
            <Button variant="outline" className="btn-premium border-primary/20 text-primary h-12">
              Configure
            </Button>
          </div>
        </div>

        {/* Biometric Scan Hub */}
        <div className="premium-card bg-white border-none shadow-premium relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
            <Fingerprint className="w-32 h-32" />
          </div>

          <div className="flex items-center gap-6 mb-8 relative z-10">
            <div className="relative">
              <div className="absolute -inset-2 bg-accent/20 rounded-2xl blur-lg animate-pulse" />
              <div className="w-16 h-16 rounded-[22px] bg-accent text-white flex items-center justify-center relative">
                <Fingerprint className="w-8 h-8" />
              </div>
            </div>
            <div>
              <h3 className="text-2xl font-black text-wellness-forest">Biometric Hub</h3>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Awaiting Command</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-8 relative z-10">
            <div className="p-4 rounded-2xl bg-wellness-cream border border-border">
              <p className="text-[10px] font-black text-muted-foreground uppercase mb-1">Accuracy Grade</p>
              <p className="text-sm font-bold text-wellness-forest">Tier-1 High</p>
            </div>
            <div className="p-4 rounded-2xl bg-wellness-cream border border-border">
              <p className="text-[10px] font-black text-muted-foreground uppercase mb-1">Encrypted Tunnel</p>
              <div className="flex items-center gap-2 mt-1">
                <ShieldCheck className="w-4 h-4 text-primary" />
                <span className="text-xs font-black text-primary">SECURE</span>
              </div>
            </div>
          </div>

          <div className="space-y-3 relative z-10">
            <div className="flex justify-between items-center text-xs font-bold px-1">
              <span className="text-muted-foreground">Processor</span>
              <div className="flex items-center gap-2 font-black text-wellness-forest">
                <Cpu className="w-3 h-3" />
                <span>ARM Cortex-M4</span>
              </div>
            </div>
            <div className="flex justify-between items-center text-xs font-bold px-1">
              <span className="text-muted-foreground">Daily Throughput</span>
              <span className="text-wellness-forest font-black">1.4k Identifications</span>
            </div>
          </div>

          <div className="flex gap-3 mt-8 relative z-10">
            <Button
              disabled={!!testing}
              onClick={() => runTest('bio')}
              className="flex-1 btn-premium bg-wellness-forest text-white h-12"
            >
              <Activity className={`w-4 h-4 mr-2 ${testing === 'bio' ? 'animate-bounce' : ''}`} />
              {testing === 'bio' ? 'Calibrating...' : 'Verify Hardware'}
            </Button>
            <Button variant="outline" className="btn-premium border-primary/20 text-primary h-12">
              Logs
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
