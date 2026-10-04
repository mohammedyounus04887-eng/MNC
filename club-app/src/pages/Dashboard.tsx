import { IndianRupee, Users, CalendarClock, UserCheck, HeartHandshake, Plus, ShoppingCart, ClipboardCheck, UserPlus, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { members, salesTrendData, membershipGrowthData, productSalesData, packageDistributionData } from "@/data/mockData";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar } from "recharts";

const stats = [
  { label: "Today's Revenue", value: "₹4,970", icon: IndianRupee, color: "bg-primary/20 text-primary" },
  { label: "Monthly Revenue", value: "₹1,24,500", icon: TrendingUp, color: "bg-emerald-100 text-emerald-600" },
  { label: "Active Members", value: "8", icon: Users, color: "bg-blue-100 text-blue-600" },
  { label: "Expiring Soon", value: "3", icon: CalendarClock, color: "bg-amber-100 text-amber-600" },
  { label: "Today's Attendance", value: "7", icon: UserCheck, color: "bg-wellness-mint text-wellness-forest" },
  { label: "Volunteers", value: "4", icon: HeartHandshake, color: "bg-accent/20 text-accent" },
];

const expiringMembers = members.filter(m => m.daysLeft > 0 && m.daysLeft <= 3);

export default function Dashboard() {
  return (
    <div className="space-y-6 md:space-y-10 animate-fade-in relative">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 md:gap-6">
        <div className="min-w-0">
          <h2 className="text-2xl sm:text-3xl font-black text-wellness-forest tracking-tight">Main Dashboard</h2>
          <p className="text-muted-foreground font-bold mt-1 text-sm sm:text-base">Operational Overview for Usha Prasad Enterprise</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <Link to="/billing" className="w-full sm:w-auto">
            <Button className="w-full btn-premium bg-primary text-white min-h-[48px] touch-manipulation">
              <Plus className="w-5 h-5" /> New Billing
            </Button>
          </Link>
          <Button variant="outline" className="w-full sm:w-auto btn-premium border-2 border-primary/20 text-primary hover:bg-primary/5 min-h-[48px] touch-manipulation">
            Download Report
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-6">
        {stats.map((s) => (
          <div key={s.label} className="premium-card group hover-lift flex flex-col items-center text-center justify-center p-4 sm:p-6 md:p-8">
            <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl ${s.color} flex items-center justify-center mb-2 sm:mb-4 group-hover:scale-110 transition-transform duration-300 shadow-sm`}>
              <s.icon className="w-6 h-6 sm:w-7 sm:h-7" />
            </div>
            <p className="text-lg sm:text-2xl font-black text-wellness-forest leading-tight tracking-tight">{s.value}</p>
            <p className="text-[10px] sm:text-xs font-bold text-muted-foreground uppercase tracking-widest mt-1 line-clamp-2">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Charts Section */}
      <div className="grid lg:grid-cols-7 gap-4 md:gap-8">
        <div className="lg:col-span-4 premium-card space-y-4 md:space-y-6 p-4 md:p-6">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-lg sm:text-xl font-black text-wellness-forest">Revenue Trends</h3>
            <div className="text-xs font-bold px-3 py-1 rounded-full bg-wellness-mint text-wellness-forest flex-shrink-0">Last 30 Days</div>
          </div>
          <div className="h-[260px] sm:h-[300px] md:h-[350px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={salesTrendData}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#66BB6A" stopOpacity={0.1} />
                    <stop offset="95%" stopColor="#66BB6A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E8F5E9" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11, fontWeight: 'bold', fill: '#94A3B8' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fontWeight: 'bold', fill: '#94A3B8' }} />
                <Tooltip
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05)' }}
                  itemStyle={{ fontWeight: 'bold', color: '#66BB6A' }}
                />
                <Line type="monotone" dataKey="revenue" stroke="#66BB6A" strokeWidth={4} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 8, strokeWidth: 0, fill: '#66BB6A' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-3 premium-card space-y-4 md:space-y-6 p-4 md:p-6">
          <h3 className="text-lg sm:text-xl font-black text-wellness-forest">Product Sales</h3>
          <div className="h-[260px] sm:h-[300px] md:h-[350px] w-full flex items-center justify-center relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={productSalesData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={85}
                  paddingAngle={8}
                  dataKey="value"
                >
                  {productSalesData.map((entry, i) => <Cell key={i} fill={entry.fill} className="stroke-white outline-none" />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute flex flex-col items-center justify-center">
              <p className="text-xs font-black text-muted-foreground uppercase truncate">Total</p>
              <p className="text-2xl font-black text-wellness-forest">100%</p>
            </div>
          </div>
        </div>
      </div>

      {/* Expiry Alerts - Instagram Style Cards */}
      {expiringMembers.length > 0 && (
        <div className="space-y-4 md:space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h3 className="text-xl sm:text-2xl font-black text-wellness-forest">⚠️ Priority Expiry Alerts</h3>
            <Link to="/expiry" className="text-sm font-black text-primary hover:underline touch-manipulation">View All Alerts</Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            {expiringMembers.map((m) => (
              <div key={m.id} className="premium-card p-4 hover-lift border-l-8 border-wellness-forest space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-white shadow-sm ring-2 ring-primary/20">
                    <img src={`https://i.pravatar.cc/150?u=${m.id}`} alt={m.name} className="w-full h-full object-cover" />
                  </div>
                  <div>
                    <h4 className="font-black text-wellness-forest leading-tight truncate">{m.name}</h4>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">{m.id}</p>
                  </div>
                </div>
                <div className="bg-wellness-mint p-3 rounded-xl flex items-center justify-between">
                  <p className="text-xs font-black text-wellness-forest uppercase">Expires in</p>
                  <p className="text-lg font-black text-wellness-forest">{m.daysLeft} Days</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1 btn-premium bg-primary h-10 sm:h-9 text-xs min-h-[44px] sm:min-h-0 touch-manipulation">Renew Now</Button>
                  <Button size="sm" variant="outline" className="flex-1 btn-premium border-primary/20 h-10 sm:h-9 text-xs min-h-[44px] sm:min-h-0 touch-manipulation">Notify</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions Panel */}
      <div className="premium-card bg-wellness-forest overflow-hidden relative">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/20 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2" />
        <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6 md:gap-8 py-4 px-2 sm:px-4">
          <div className="space-y-2 text-center md:text-left">
            <h3 className="text-xl sm:text-2xl font-black text-white leading-tight">Club Management Tools</h3>
            <p className="text-white/60 font-bold text-sm sm:text-base">Quickly access essential features of Magic Nutrition Club.</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 w-full md:w-auto">
            {[
              { label: "New Member", icon: UserPlus, path: "/members" },
              { label: "Attendance", icon: ClipboardCheck, path: "/members" },
              { label: "Inventory", icon: HeartHandshake, path: "/inventory" },
              { label: "Settings", icon: ShoppingCart, path: "/nfc" }
            ].map((action, i) => (
              <Link key={i} to={action.path} className="touch-manipulation min-h-[80px] sm:min-h-0">
                <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 flex flex-col items-center justify-center gap-2 hover:bg-white/20 transition-all active:scale-95 group h-full min-h-[80px]">
                  <action.icon className="w-6 h-6 text-white group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] font-black text-white uppercase tracking-wider">{action.label}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
