import React from "react";
import { LucideIcon } from "lucide-react";

export interface ReportSummaryCardProps {
    title: string;
    value: string | number;
    subtitle?: string;
    icon: LucideIcon;
    colorClass: string;
}

export default function ReportSummaryCard({ title, value, subtitle, icon: Icon, colorClass }: ReportSummaryCardProps) {
    return (
        <div className="bg-white rounded-2xl p-6 border shadow-sm flex items-start gap-4 transition-all hover:shadow-premium">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${colorClass}`}>
                <Icon className="w-6 h-6" />
            </div>
            <div className="min-w-0">
                <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">{title}</p>
                <p className="text-2xl sm:text-3xl font-black text-slate-900 mt-1 truncate">{value}</p>
                {subtitle && (
                    <p className="text-xs font-semibold text-slate-500 mt-1">{subtitle}</p>
                )}
            </div>
        </div>
    );
}
