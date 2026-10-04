import { useState } from "react";
import { Search, Filter, Eye, Star, Medal, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import { members, Member } from "@/data/mockData";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function Members() {
  const [search, setSearch] = useState("");
  const [filterPkg, setFilterPkg] = useState<string>("All");

  const filtered = members.filter((m) => {
    if (search && !m.name.toLowerCase().includes(search.toLowerCase()) && !m.id.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterPkg !== "All" && m.package !== filterPkg) return false;
    return true;
  });

  const goldMembers = filtered.filter(m => m.package === "Gold");
  const silverMembers = filtered.filter(m => m.package === "Silver");
  const bronzeMembers = filtered.filter(m => m.package === "Bronze");

  const MemberCard = ({ m }: { m: Member }) => (
    <div key={m.id} className="premium-card group hover-lift relative overflow-hidden flex flex-col items-center text-center p-6 bg-white border-2 border-transparent hover:border-primary/20">
      <div className={`absolute top-0 right-0 p-3 rounded-bl-2xl ${m.package === "Gold" ? "bg-amber-100 text-amber-600" :
          m.package === "Silver" ? "bg-slate-100 text-slate-600" :
            "bg-orange-100 text-orange-600"
        }`}>
        {m.package === "Gold" ? <Trophy className="w-4 h-4" /> : m.package === "Silver" ? <Medal className="w-4 h-4" /> : <Star className="w-4 h-4" />}
      </div>

      <div className="relative mb-4">
        <div className={`w-24 h-24 rounded-full p-1 border-4 ${m.package === "Gold" ? "border-amber-400" : m.package === "Silver" ? "border-slate-300" : "border-orange-300"
          }`}>
          <img src={`https://i.pravatar.cc/150?u=${m.id}`} alt={m.name} className="w-full h-full rounded-full object-cover shadow-sm" />
        </div>
        <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-primary border-2 border-white flex items-center justify-center text-[10px] text-white font-bold">
          {m.totalPoints}
        </div>
      </div>

      <h4 className="font-black text-wellness-forest text-lg leading-tight group-hover:text-primary transition-colors">{m.name}</h4>
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mt-1 mb-4">{m.id}</p>

      <div className="w-full grid grid-cols-2 gap-2 mb-6 text-left">
        <div className="p-2 rounded-xl bg-wellness-cream">
          <p className="text-[10px] font-black text-muted-foreground uppercase">Days Left</p>
          <p className={`text-sm font-black ${m.daysLeft <= 3 ? "text-destructive" : "text-wellness-forest"}`}>{m.daysLeft} d</p>
        </div>
        <div className="p-2 rounded-xl bg-wellness-cream">
          <p className="text-[10px] font-black text-muted-foreground uppercase">Status</p>
          <p className={`text-sm font-black ${m.status === "Active" ? "text-primary" : "text-accent"}`}>{m.status}</p>
        </div>
      </div>

      <Link to={`/members/${m.id}`} className="w-full">
        <Button className="w-full btn-premium bg-secondary/30 text-primary hover:bg-primary hover:text-white group/btn">
          <Eye className="w-4 h-4 mr-2" /> View Profile
        </Button>
      </Link>
    </div>
  );

  return (
    <div className="space-y-12 animate-fade-in pb-12">
      <div className="flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-wellness-forest tracking-tight">Members Community</h2>
          <p className="text-muted-foreground font-bold">{members.length} members are transforming their lives</p>
        </div>
        <div className="flex bg-white p-1 rounded-2xl shadow-soft border border-border">
          <div className="relative flex items-center px-4 py-2 border-r border-border">
            <Search className="w-4 h-4 text-primary mr-3" />
            <input
              className="bg-transparent border-none focus:outline-none text-sm font-bold placeholder:text-muted-foreground"
              placeholder="Search members..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-1 p-1">
            {["All", "Bronze", "Silver", "Gold"].map((p) => (
              <button
                key={p}
                className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${filterPkg === p ? "bg-primary text-white shadow-premium" : "text-muted-foreground hover:bg-secondary/30 hover:text-primary"}`}
                onClick={() => setFilterPkg(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {goldMembers.length > 0 && (
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center"><Trophy className="text-amber-500 w-6 h-6" /></div>
            <h3 className="text-2xl font-black text-wellness-forest tracking-tight">🥇 Gold Members</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {goldMembers.map(m => <MemberCard m={m} key={m.id} />)}
          </div>
        </section>
      )}

      {silverMembers.length > 0 && (
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center"><Medal className="text-slate-500 w-6 h-6" /></div>
            <h3 className="text-2xl font-black text-wellness-forest tracking-tight">🥈 Silver Members</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {silverMembers.map(m => <MemberCard m={m} key={m.id} />)}
          </div>
        </section>
      )}

      {bronzeMembers.length > 0 && (
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center"><Star className="text-orange-500 w-6 h-6" /></div>
            <h3 className="text-2xl font-black text-wellness-forest tracking-tight">🥉 Bronze Members</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {bronzeMembers.map(m => <MemberCard m={m} key={m.id} />)}
          </div>
        </section>
      )}
    </div>
  );
}
