import { Trophy, Star, Target, Zap, Heart, Gift, Crown, ArrowRight } from "lucide-react";
import { members, loyaltyConfig } from "@/data/mockData";
import { Button } from "@/components/ui/button";

export default function LoyaltyRewards() {
  const topMembers = [...members].sort((a, b) => b.totalPoints - a.totalPoints).slice(0, 5);
  const starMember = topMembers[0];

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      <div className="flex items-center justify-between">
        <h2 className="text-4xl font-black text-wellness-forest tracking-tight">Loyalty & Rewards</h2>
        <div className="flex gap-2">
          <Button variant="outline" className="btn-premium rounded-full border-primary/20 text-primary">My Status</Button>
          <Button className="btn-premium bg-primary text-white">Redeem Points</Button>
        </div>
      </div>

      {/* Hero Section: Star Member of the Month */}
      <div className="relative premium-card p-0 overflow-hidden border-none bg-wellness-forest min-h-[400px] flex items-center">
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent z-10" />
        <img
          src="https://images.unsplash.com/photo-1517836357463-d25dfeac3438?q=80&w=1200"
          alt="Champion"
          className="absolute inset-0 w-full h-full object-cover opacity-50"
        />
        <div className="relative z-20 p-8 md:p-16 flex flex-col md:flex-row items-center gap-12 w-full">
          <div className="relative">
            <div className="absolute -inset-4 bg-primary/30 rounded-full blur-2xl animate-pulse" />
            <div className="w-48 h-48 rounded-full border-8 border-white shadow-premium overflow-hidden bg-white relative">
              <img src={`https://i.pravatar.cc/200?u=${starMember.id}`} alt={starMember.name} className="w-full h-full object-cover" />
            </div>
            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 bg-accent text-white px-6 py-2 rounded-full font-black text-sm shadow-premium flex items-center gap-2">
              <Trophy className="w-4 h-4" /> CHAMPION
            </div>
          </div>

          <div className="text-center md:text-left space-y-4 max-w-xl">
            <div>
              <p className="text-primary font-black uppercase tracking-[0.3em] text-sm mb-2">Member of the Month</p>
              <h3 className="text-5xl font-black text-white tracking-tight">{starMember.name}</h3>
            </div>
            <p className="text-white/70 text-lg font-bold italic leading-relaxed">
              "Usha Prasad Enterprise is proud to celebrate {starMember.name}'s incredible dedication. Their transformation journey inspires our entire community!"
            </p>
            <div className="flex items-center justify-center md:justify-start gap-6 pt-4">
              <div className="text-center">
                <p className="text-4xl font-black text-white">{starMember.totalPoints}</p>
                <p className="text-primary text-[10px] font-black uppercase">Points</p>
              </div>
              <div className="w-px h-12 bg-white/20" />
              <div className="text-center">
                <p className="text-4xl font-black text-white">#1</p>
                <p className="text-primary text-[10px] font-black uppercase">Rank</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Ways to Earn Points */}
        <div className="lg:col-span-2 space-y-6">
          <h3 className="text-2xl font-black text-wellness-forest flex items-center gap-3">
            <Zap className="text-primary w-6 h-6" /> Ways to Flourish
          </h3>
          <div className="grid md:grid-cols-2 gap-4">
            {loyaltyConfig.map((item, i) => (
              <div key={i} className="premium-card bg-white hover:bg-wellness-mint/30 transition-all border-border group">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${i % 3 === 0 ? "bg-primary/10 text-primary" :
                      i % 3 === 1 ? "bg-accent/10 text-accent" :
                        "bg-blue-500/10 text-blue-500"
                    } group-hover:scale-110 transition-transform`}>
                    {i % 3 === 0 ? <Heart className="w-6 h-6" /> : i % 3 === 1 ? <Target className="w-6 h-6" /> : <Gift className="w-6 h-6" />}
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-wellness-forest">{item.activity}</h4>
                    <p className="text-[10px] font-black text-muted-foreground uppercase">Reward</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-black text-wellness-forest">+{item.points}</p>
                    <p className="text-[10px] font-black text-primary uppercase">Tokens</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Global Leaderboard */}
        <div className="space-y-6">
          <h3 className="text-2xl font-black text-wellness-forest flex items-center gap-3">
            <Crown className="text-accent w-6 h-6" /> Leaderboard
          </h3>
          <div className="premium-card p-4 space-y-3 bg-wellness-sage/10 backdrop-blur-sm">
            {topMembers.map((m, i) => (
              <div key={m.id} className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${i === 0 ? "bg-white shadow-premium border-primary border-2 translate-x-2" : "bg-white/50 border-border hover:bg-white"
                }`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black ${i === 0 ? "bg-primary text-white" : "bg-secondary/30 text-wellness-forest"
                  }`}>
                  {i + 1}
                </div>
                <div className="w-10 h-10 rounded-full overflow-hidden bg-slate-100 flex-shrink-0">
                  <img src={`https://i.pravatar.cc/100?u=${m.id}`} alt={m.name} className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-wellness-forest truncate">{m.name}</p>
                  <p className="text-[10px] font-black text-muted-foreground uppercase">{m.package} Plan</p>
                </div>
                <div className="text-right">
                  <p className="font-black text-primary">{m.totalPoints}</p>
                  <p className="text-[10px] font-bold text-muted-foreground">PTS</p>
                </div>
              </div>
            ))}
            <Button variant="ghost" className="w-full text-xs font-black text-primary mt-4 group">
              View Full Rankings <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
