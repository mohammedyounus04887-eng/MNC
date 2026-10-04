import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Star, Calendar, ShoppingBag, History, Trophy, Award, Target } from "lucide-react";
import { members } from "@/data/mockData";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export default function MemberProfile() {
  const { id } = useParams();
  const member = members.find((m) => m.id === id);

  if (!member) return <div className="p-8 text-center text-muted-foreground animate-in">Member not found.</div>;

  const totalDays = Math.max(1, Math.round((new Date(member.expiryDate).getTime() - new Date(member.startDate).getTime()) / 86400000));
  const elapsed = totalDays - member.daysLeft;
  const progress = Math.min(100, Math.max(0, (elapsed / totalDays) * 100));

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      <Link to="/members" className="inline-flex items-center gap-2 text-sm font-black text-primary hover:translate-x-[-4px] transition-transform">
        <ArrowLeft className="w-4 h-4" /> Back to Members Community
      </Link>

      {/* Hero Banner Header */}
      <div className="relative premium-card p-0 overflow-hidden border-none bg-wellness-forest min-h-[300px] flex items-end">
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent z-10" />
        <img
          src="https://images.unsplash.com/photo-1543353071-873f17a7a088?q=80&w=1200"
          alt="Banner"
          className="absolute inset-0 w-full h-full object-cover opacity-60"
        />
        <div className="relative z-20 p-8 md:p-12 flex flex-col md:flex-row items-center gap-8 w-full">
          <div className="w-32 h-32 rounded-full border-4 border-white shadow-premium overflow-hidden bg-white">
            <img src={`https://i.pravatar.cc/150?u=${member.id}`} alt={member.name} className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 text-center md:text-left space-y-2">
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-3">
              <h2 className="text-4xl font-black text-white tracking-tight">{member.name}</h2>
              <span className={`px-4 py-1 rounded-full text-xs font-black uppercase tracking-widest ${member.package === "Gold" ? "bg-amber-400 text-amber-900" :
                member.package === "Silver" ? "bg-slate-300 text-slate-800" :
                  "bg-orange-400 text-orange-900"
                }`}>
                {member.package} Member
              </span>
            </div>
            <p className="text-white/70 font-bold text-lg">{member.id} • {member.phone} • Member since {member.startDate}</p>
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 pt-4">
              <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10">
                <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
                <span className="text-white font-black">{member.totalPoints} Points</span>
              </div>
              <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10">
                <Target className="w-5 h-5 text-primary" />
                <span className="text-white font-black">{member.status}</span>
              </div>
            </div>
          </div>
          <div className="hidden lg:flex gap-3">
            <Button className="btn-premium bg-primary text-white h-12">Edit Profile</Button>
            <Button className="btn-premium bg-white text-wellness-forest h-12">Renew Now</Button>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Left Column: Stats & Progress */}
        <div className="lg:col-span-1 space-y-8 text-center sm:text-left">
          <div className="premium-card space-y-6">
            <div className="flex items-center gap-3">
              <Award className="text-primary w-6 h-6" />
              <h3 className="text-xl font-black text-wellness-forest">Membership Lifecycle</h3>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <p className="text-xs font-black text-muted-foreground uppercase">Progress</p>
                <p className="text-2xl font-black text-wellness-forest">{Math.round(progress)}%</p>
              </div>
              <Progress value={progress} className="h-4 bg-secondary/30" />
              <div className="flex justify-between text-xs font-bold text-muted-foreground pt-1">
                <span>Joined {member.startDate}</span>
                <span>Expires {member.expiryDate}</span>
              </div>
              <div className="p-4 rounded-2xl bg-wellness-mint text-center border border-primary/10">
                <p className="text-xs font-black text-wellness-forest uppercase tracking-widest">Remaining Lifetime</p>
                <p className="text-3xl font-black text-wellness-forest mt-1">{member.daysLeft} Days</p>
              </div>
            </div>
          </div>

          <div className="premium-card">
            <h3 className="text-xl font-black text-wellness-forest mb-6 flex items-center gap-3"><Trophy className="text-accent w-6 h-6" /> Achievements</h3>
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="aspect-square rounded-2xl bg-wellness-cream border border-border flex flex-col items-center justify-center p-2 group hover:bg-white hover:shadow-soft transition-all">
                  <div className="w-10 h-10 rounded-full bg-secondary/50 flex items-center justify-center mb-1 group-hover:scale-110 transition-transform">
                    <Star className="w-5 h-5 text-primary" />
                  </div>
                  <span className="text-[10px] font-black text-muted-foreground uppercase text-center">Badge {i}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Timeline & History */}
        <div className="lg:col-span-2 space-y-8">
          {/* Purchase Cards (Image-based) */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-2xl font-black text-wellness-forest flex items-center gap-3"><ShoppingBag className="text-primary w-6 h-6" /> Recent Purchases</h3>
              <Button variant="ghost" className="text-sm font-black text-primary">View Store</Button>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              {member.billingHistory.slice(0, 2).map((bill, i) => (
                <div key={i} className="premium-card p-4 flex gap-4 hover-lift">
                  <div className="w-20 h-20 rounded-xl bg-wellness-mint overflow-hidden flex-shrink-0">
                    <img
                      src={i === 0 ? "https://images.unsplash.com/photo-1593095394430-fc1ca9fb99f3?q=80&w=200" : "https://images.unsplash.com/photo-1540420773420-3366772f4999?q=80&w=200"}
                      alt="Product"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-black text-primary uppercase">{bill.date}</p>
                    <h4 className="font-bold text-wellness-forest truncate mt-0.5">{bill.items}</h4>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-lg font-black text-wellness-forest">₹{bill.amount}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-secondary/50 text-wellness-forest">{bill.billNo}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Attendance History */}
          <div className="premium-card">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-xl font-black text-wellness-forest flex items-center gap-3"><Calendar className="text-primary w-6 h-6" /> Attendance Timeline</h3>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="rounded-full text-xs font-black">Week</Button>
                <Button size="sm" variant="secondary" className="rounded-full text-xs font-black">Month</Button>
              </div>
            </div>

            <div className="relative space-y-8 before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">
              {member.attendance.map((a, i) => (
                <div key={i} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-secondary shadow-sm shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                    <Calendar className="w-5 h-5 text-primary" />
                  </div>
                  <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-2xl bg-wellness-cream border border-border hover:border-primary/20 hover:bg-white hover:shadow-soft transition-all">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                      <time className="text-sm font-black text-wellness-forest">{a.date}</time>
                      <div className="bg-white px-3 py-1 rounded-full border border-border text-[10px] font-bold text-primary">
                        {a.inTime} - {a.outTime}
                      </div>
                    </div>
                    <div className="mt-2 text-xs font-bold text-muted-foreground italic">Early Bird Training Session</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Points History */}
          <div className="premium-card">
            <h3 className="text-xl font-black text-wellness-forest mb-6 flex items-center gap-3"><History className="text-primary w-6 h-6" /> Points Activity</h3>
            <div className="space-y-3">
              {member.pointsHistory.map((p, i) => (
                <div key={i} className="flex items-center justify-between p-4 rounded-2xl bg-wellness-cream border border-border group hover:bg-white transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-colors">
                      <Star className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-bold text-wellness-forest">{p.activity}</p>
                      <p className="text-xs text-muted-foreground font-bold">{p.date}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-black text-primary">+{p.points}</p>
                    <p className="text-[10px] font-black text-muted-foreground uppercase">Tokens</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
