import { useState } from "react";
import { dailySalesData, paymentSplitData } from "@/data/mockData";
import { Input } from "@/components/ui/input";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from "recharts";
import { TrendingUp, CreditCard, DollarSign, Users, Calendar, Download, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";

const membershipRevenue = [
  { pkg: "Bronze", revenue: 7500, count: 5, fill: "hsl(30, 60%, 55%)" },
  { pkg: "Silver", revenue: 17500, count: 7, fill: "hsl(0, 0%, 65%)" },
  { pkg: "Gold", revenue: 28000, count: 7, fill: "hsl(45, 90%, 50%)" },
];

export default function BillingReports() {
  const [fromDate, setFromDate] = useState("2026-02-01");
  const [toDate, setToDate] = useState("2026-02-20");
  const totalRevenue = dailySalesData.reduce((s, d) => s + d.revenue, 0);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-wellness-forest/90 backdrop-blur-md border border-white/20 p-4 rounded-2xl shadow-premium">
          <p className="text-[10px] font-black text-primary uppercase tracking-widest mb-1">{label}</p>
          <p className="text-xl font-black text-white">₹{payload[0].value.toLocaleString()}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-4xl font-black text-wellness-forest tracking-tight">Revenue Analytics</h2>
          <p className="text-primary font-black uppercase tracking-widest text-xs mt-1">Club Performance Insights</p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-2xl border border-border">
            <Calendar className="w-4 h-4 text-primary" />
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-[130px] border-none p-0 h-auto focus-visible:ring-0 text-xs font-bold" />
            <span className="text-muted-foreground text-xs font-black px-2">TO</span>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-[130px] border-none p-0 h-auto focus-visible:ring-0 text-xs font-bold" />
          </div>
          <Button variant="outline" className="btn-premium border-primary/20 text-primary">
            <Download className="w-4 h-4 mr-2" /> PDF
          </Button>
        </div>
      </div>

      {/* Insight Cards */}
      <div className="grid md:grid-cols-4 gap-6">
        <div className="premium-card bg-wellness-forest text-white border-none flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <p className="text-2xl font-black">₹{totalRevenue.toLocaleString()}</p>
            <p className="text-white/40 font-black text-[10px] uppercase">Gross Revenue</p>
          </div>
        </div>
        <div className="premium-card bg-white border-none shadow-premium flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <TrendingUp className="w-6 h-6 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-black text-wellness-forest">14.2%</p>
            <p className="text-muted-foreground font-black text-[10px] uppercase">Growth MoM</p>
          </div>
        </div>
        <div className="premium-card bg-white border-none shadow-premium flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center">
            <CreditCard className="w-6 h-6 text-accent" />
          </div>
          <div>
            <p className="text-2xl font-black text-wellness-forest">₹1.2k</p>
            <p className="text-muted-foreground font-black text-[10px] uppercase">Avg Ticket Size</p>
          </div>
        </div>
        <div className="premium-card bg-wellness-mint border-none shadow-soft flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <Users className="w-6 h-6 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-black text-wellness-forest">18</p>
            <p className="text-muted-foreground font-black text-[10px] uppercase">Active Volunteers</p>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Daily Sales Chart */}
        <div className="premium-card bg-white border-none shadow-premium space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-black text-wellness-forest flelx items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" /> Revenue Velocity
            </h3>
            <span className="bg-primary/10 text-primary text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest">Real-time</span>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailySalesData}>
                <defs>
                  <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#66BB6A" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#66BB6A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(120,15%,95%)" />
                <XAxis dataKey="product" tick={{ fontSize: 10, fontWeight: 700 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fontWeight: 700 }} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="revenue" stroke="#66BB6A" strokeWidth={4} fillOpacity={1} fill="url(#colorRev)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Payment Split */}
        <div className="premium-card bg-white border-none shadow-premium space-y-6">
          <h3 className="text-xl font-black text-wellness-forest flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-accent" /> Cash vs Digital
          </h3>
          <div className="flex items-center justify-center relative h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={paymentSplitData}
                  cx="50%" cy="50%"
                  innerRadius={80} outerRadius={110}
                  paddingAngle={8}
                  dataKey="value"
                >
                  {paymentSplitData.map((e, i) => (
                    <Cell key={i} fill={e.fill} stroke="transparent" />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <p className="text-[10px] font-black text-muted-foreground uppercase">Majority</p>
              <p className="text-3xl font-black text-wellness-forest">UPI</p>
              <p className="text-[10px] font-black text-primary uppercase mt-1">45%</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Product Performance */}
        <div className="lg:col-span-2 premium-card p-0 overflow-hidden border-none shadow-premium bg-white">
          <div className="p-6 border-b border-border font-black text-wellness-forest uppercase tracking-widest text-xs flex justify-between items-center">
            <span>Top Consumables</span>
            <Filter className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-wellness-sage/5 border-b border-border text-left">
                  <th className="px-8 py-5 text-[10px] font-black text-muted-foreground uppercase">Product</th>
                  <th className="px-6 py-5 text-[10px] font-black text-muted-foreground uppercase text-center">Volume</th>
                  <th className="px-8 py-5 text-right text-[10px] font-black text-muted-foreground uppercase">Contribution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {dailySalesData.map((d, i) => (
                  <tr key={i} className="hover:bg-wellness-mint/10 transition-colors">
                    <td className="px-8 py-5 font-bold text-wellness-forest">{d.product}</td>
                    <td className="px-6 py-5 text-center">
                      <span className="px-3 py-1 rounded-full bg-wellness-sage/10 text-wellness-forest text-xs font-black">{d.qty} Units</span>
                    </td>
                    <td className="px-8 py-5 text-right font-black text-primary">₹{d.revenue.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Membership Yield */}
        <div className="premium-card p-0 overflow-hidden border-none shadow-premium bg-white">
          <div className="p-6 border-b border-border font-black text-wellness-forest uppercase tracking-widest text-xs flex justify-between items-center bg-wellness-forest text-white">
            <span>Membership Yield</span>
            <Users className="w-4 h-4 text-white/50" />
          </div>
          <div className="p-6 space-y-6">
            {membershipRevenue.map((m, i) => (
              <div key={i} className="space-y-2">
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-xs font-black text-muted-foreground uppercase tracking-widest">{m.pkg} Plan</p>
                    <p className="text-lg font-black text-wellness-forest">{m.count} Members</p>
                  </div>
                  <p className="text-xl font-black text-primary">₹{m.revenue.toLocaleString()}</p>
                </div>
                <div className="h-2 w-full bg-wellness-sage/10 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(m.revenue / 30000) * 100}%`, backgroundColor: m.fill }} />
                </div>
              </div>
            ))}
            <div className="pt-6 border-t border-border flex justify-between items-center">
              <p className="text-xs font-black text-muted-foreground uppercase">Total Pipeline</p>
              <p className="text-2xl font-black text-wellness-forest">₹53,000</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
