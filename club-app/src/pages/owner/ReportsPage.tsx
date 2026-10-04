import { useState, useRef } from "react";
import { useClubContext } from "@/lib/clubDetection";
import { format, subDays, startOfMonth } from "date-fns";
import { Activity, Users, DollarSign, Calendar, TrendingUp, Package, Clock, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { openDailyInvoiceWindow } from "@/utils/dailyTaxInvoice";
import {
    useRevenueReport,
    useMemberGrowthReport,
    useAttendanceReport,
    useProductUsageReport,
    useVolunteerHoursReport,
    useOverallSummary
} from "@/hooks/useReports";

import RevenueChart from "@/components/reports/RevenueChart";
import MemberGrowthChart from "@/components/reports/MemberGrowthChart";
import AttendanceTrendChart from "@/components/reports/AttendanceTrendChart";
import ProductUsageChart from "@/components/reports/ProductUsageChart";
import ReportSummaryCard from "@/components/reports/ReportSummaryCard";
import ExportButton from "@/components/reports/ExportButton";

export default function ReportsPage() {
    const { club } = useClubContext();

    // Date Range State
    const [startDate, setStartDate] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
    const [endDate, setEndDate] = useState(format(new Date(), "yyyy-MM-dd"));

    // Quick Ranges
    const handleQuickRange = (days: number) => {
        setStartDate(format(subDays(new Date(), days), "yyyy-MM-dd"));
        setEndDate(format(new Date(), "yyyy-MM-dd"));
    };

    const handleThisYear = () => {
        setStartDate(format(new Date(new Date().getFullYear(), 0, 1), "yyyy-MM-dd"));
        setEndDate(format(new Date(), "yyyy-MM-dd"));
    };

    // Current month for volunteer report
    const currMonthStr = endDate.slice(0, 7); // "yyyy-MM"

    // Fetch Hooks
    const overall = useOverallSummary();
    const revReport = useRevenueReport(startDate, endDate);
    const memReport = useMemberGrowthReport(startDate, endDate);
    const attReport = useAttendanceReport(startDate, endDate);
    const prodReport = useProductUsageReport(startDate, endDate);
    const volReport = useVolunteerHoursReport(currMonthStr);

    const primaryColor = club?.primaryColor || "#3b82f6";
    const currency = club?.currencyName || "Coins";

    // Refs for Exporting
    const pageRef = useRef<HTMLDivElement>(null);
    const revRef = useRef<HTMLDivElement>(null);
    const memRef = useRef<HTMLDivElement>(null);
    const attRef = useRef<HTMLDivElement>(null);
    const prodRef = useRef<HTMLDivElement>(null);

    // Daily tax invoice — date picker + download
    const [invoiceDate, setInvoiceDate] = useState(format(new Date(), "yyyy-MM-dd"));
    const [invoiceLoading, setInvoiceLoading] = useState(false);
    const handleDownloadInvoice = async () => {
        if (!club?.id) return;
        setInvoiceLoading(true);
        try {
            await openDailyInvoiceWindow(club.id, invoiceDate);
        } finally {
            setInvoiceLoading(false);
        }
    };

    return (
        <div className="space-y-8 pb-12 animate-fade-in" ref={pageRef}>
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight">Reports & Analytics</h1>
                    <p className="text-sm text-slate-500 font-medium">Data-driven insights for {club?.name || "your club"}</p>
                </div>
                <div className="flex items-center gap-2">
                    <ExportButton
                        reportTitle="Full Analytics Report"
                        clubName={club?.name || ""}
                        dateRangeStr={`${startDate} to ${endDate}`}
                        targetRef={pageRef}
                        variant="default"
                    />
                </div>
            </div>

            {/* Date Filters */}
            <div className="bg-white p-4 rounded-2xl border flex flex-wrap gap-4 items-center">
                <div className="flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-slate-400" />
                    <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-[140px]" />
                    <span className="text-sm font-bold text-slate-400">TO</span>
                    <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-[140px]" />
                </div>
                <div className="h-6 w-px bg-slate-200 hidden md:block" />
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleQuickRange(7)}>7 Days</Button>
                    <Button variant="outline" size="sm" onClick={() => handleQuickRange(30)}>30 Days</Button>
                    <Button variant="outline" size="sm" onClick={() => handleQuickRange(90)}>3 Months</Button>
                    <Button variant="outline" size="sm" onClick={handleThisYear}>This Year</Button>
                </div>
            </div>

            {/* Daily Tax Invoice — generate / download for any day */}
            <div className="bg-white p-5 rounded-2xl border flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600">
                        <FileText className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-base font-black text-slate-800">Daily Tax Invoice</h3>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">
                            Download a GST-compliant tax invoice (Usha Prasad Enterprises) for any day's shake & product sales.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Input
                        type="date"
                        value={invoiceDate}
                        max={format(new Date(), "yyyy-MM-dd")}
                        onChange={(e) => setInvoiceDate(e.target.value)}
                        className="w-[150px]"
                    />
                    <Button onClick={handleDownloadInvoice} disabled={!club?.id || invoiceLoading}>
                        <Download className="w-4 h-4 mr-2" />
                        {invoiceLoading ? "Loading..." : "Download Invoice"}
                    </Button>
                </div>
            </div>

            {/* Summary KPIs */}
            {overall.isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <ReportSummaryCard
                        title="Revenue (Selected)"
                        value={`${revReport.data?.totalRevenue?.toLocaleString() || 0} ${currency}`}
                        subtitle={`Avg ${revReport.data?.avgDaily ? Math.round(revReport.data.avgDaily) : 0}/day`}
                        icon={DollarSign}
                        colorClass="bg-emerald-100 text-emerald-600"
                    />
                    <ReportSummaryCard
                        title="New Members"
                        value={memReport.data?.totalNewMembers || 0}
                        subtitle={`Total active: ${overall.data?.activeMembers || 0}`}
                        icon={Users}
                        colorClass="bg-blue-100 text-blue-600"
                    />
                    <ReportSummaryCard
                        title="Avg Daily Attendance"
                        value={attReport.data?.avgDaily ? Math.round(attReport.data.avgDaily) : 0}
                        subtitle={`${attReport.data?.attendanceRate ? Math.round(attReport.data.attendanceRate) : 0}% Active Rate`}
                        icon={TrendingUp}
                        colorClass="bg-violet-100 text-violet-600"
                    />
                    <ReportSummaryCard
                        title="Total Orders (Month)"
                        value={overall.data?.totalOrdersThisMonth || 0}
                        subtitle="This month to date"
                        icon={Package}
                        colorClass="bg-amber-100 text-amber-600"
                    />
                </div>
            )}

            {/* Revenue Section */}
            <div className="bg-white rounded-3xl border shadow-sm p-6" ref={revRef}>
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
                            <DollarSign className="w-5 h-5 text-emerald-500" /> Revenue & Cash Flow
                        </h2>
                        <p className="text-sm font-medium text-slate-500 mt-1">Daily debit transactions recorded</p>
                    </div>
                    <ExportButton
                        reportTitle="Revenue Report"
                        clubName={club?.name || ""}
                        dateRangeStr={`${startDate} to ${endDate}`}
                        targetRef={revRef}
                    />
                </div>
                {revReport.isLoading ? <Skeleton className="h-[300px] w-full rounded-2xl" /> : (
                    <>
                        <RevenueChart data={revReport.data?.dailyRevenue || []} currencyName={currency} primaryColor={primaryColor} />
                        <div className="mt-4 grid grid-cols-3 gap-4 border-t pt-4">
                            <div>
                                <p className="text-xs uppercase font-bold text-slate-400 tracking-wider">Total Revenue</p>
                                <p className="text-lg font-black text-slate-800 mt-1">{revReport.data?.totalRevenue || 0} {currency}</p>
                            </div>
                            <div>
                                <p className="text-xs uppercase font-bold text-slate-400 tracking-wider">Best Day</p>
                                <p className="text-lg font-black text-slate-800 mt-1">{revReport.data?.bestDay || "-"}</p>
                            </div>
                        </div>
                    </>
                )}
            </div>

            <div className="grid lg:grid-cols-2 gap-8">
                {/* Member Growth */}
                <div className="bg-white rounded-3xl border shadow-sm p-6" ref={memRef}>
                    <div className="flex justify-between items-start mb-6">
                        <div>
                            <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
                                <Users className="w-5 h-5 text-blue-500" /> Member Growth
                            </h2>
                        </div>
                        <ExportButton
                            reportTitle="Member Growth Report"
                            clubName={club?.name || ""}
                            dateRangeStr={`${startDate} to ${endDate}`}
                            targetRef={memRef}
                        />
                    </div>
                    {memReport.isLoading ? <Skeleton className="h-[300px] w-full rounded-2xl" /> : (
                        <MemberGrowthChart data={memReport.data?.dailyJoins || []} primaryColor={primaryColor} />
                    )}
                </div>

                {/* Attendance Trends */}
                <div className="bg-white rounded-3xl border shadow-sm p-6" ref={attRef}>
                    <div className="flex justify-between items-start mb-6">
                        <div>
                            <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
                                <Activity className="w-5 h-5 text-violet-500" /> Attendance Trends
                            </h2>
                        </div>
                        <ExportButton
                            reportTitle="Attendance Report"
                            clubName={club?.name || ""}
                            dateRangeStr={`${startDate} to ${endDate}`}
                            targetRef={attRef}
                        />
                    </div>
                    {attReport.isLoading ? <Skeleton className="h-[300px] w-full rounded-2xl" /> : (
                        <AttendanceTrendChart
                            data={attReport.data?.dailyAttendance || []}
                            totalActiveMembers={attReport.data?.totalActiveMembers || 0}
                            primaryColor={primaryColor}
                        />
                    )}
                </div>
            </div>

            {/* Product Usage */}
            <div className="bg-white rounded-3xl border shadow-sm p-6" ref={prodRef}>
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
                            <Package className="w-5 h-5 text-amber-500" /> Product Consumption
                        </h2>
                        <p className="text-sm font-medium text-slate-500 mt-1">Most consumed and ordered products</p>
                    </div>
                    <ExportButton
                        reportTitle="Product Consumption Report"
                        clubName={club?.name || ""}
                        dateRangeStr={`${startDate} to ${endDate}`}
                        targetRef={prodRef}
                    />
                </div>
                {prodReport.isLoading ? <Skeleton className="h-[300px] w-full rounded-2xl" /> : (
                    <ProductUsageChart data={prodReport.data?.productUsage || []} currencyName={currency} primaryColor={primaryColor} />
                )}
            </div>

            {/* Volunteer Hours - Table Format */}
            <div className="bg-white rounded-3xl border shadow-sm p-6">
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
                            <Clock className="w-5 h-5 text-rose-500" /> Staff & Volunteer Hours
                        </h2>
                        <p className="text-sm font-medium text-slate-500 mt-1">For {format(new Date(currMonthStr + "-01"), "MMMM yyyy")}</p>
                    </div>
                </div>
                {volReport.isLoading ? <Skeleton className="h-40 w-full rounded-2xl" /> : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[500px]">
                            <thead>
                                <tr className="border-b bg-slate-50">
                                    <th className="py-3 px-4 text-left font-bold text-xs uppercase tracking-wider text-slate-500">Name</th>
                                    <th className="py-3 px-4 text-center font-bold text-xs uppercase tracking-wider text-slate-500">Total Hours</th>
                                    <th className="py-3 px-4 text-center font-bold text-xs uppercase tracking-wider text-slate-500">Days Active</th>
                                </tr>
                            </thead>
                            <tbody>
                                {volReport.data?.volunteerHours?.map((v: any, i: number) => (
                                    <tr key={v.volunteerId} className={`border-b border-dashed ${i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                                        <td className="py-3 px-4 font-bold text-slate-800 flex items-center gap-2">
                                            {v.name}
                                        </td>
                                        <td className="py-3 px-4 text-center">
                                            <span className="bg-rose-100 text-rose-700 px-3 py-1 rounded-full text-sm font-black">
                                                {v.totalHours} hr
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-center text-sm font-bold text-slate-600">
                                            {v.daysWorked} days
                                        </td>
                                    </tr>
                                ))}
                                {(!volReport.data?.volunteerHours || volReport.data.volunteerHours.length === 0) && (
                                    <tr>
                                        <td colSpan={3} className="py-8 text-center text-slate-400 font-medium text-sm">
                                            No staff or volunteer hours logged in this month.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
