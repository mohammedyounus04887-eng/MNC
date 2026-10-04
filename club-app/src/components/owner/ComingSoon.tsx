import { useNavigate, useLocation } from "react-router-dom";
import { Construction, ArrowLeft } from "lucide-react";

interface ComingSoonProps {
    pageName: string;
}

export default function ComingSoon({ pageName }: ComingSoonProps) {
    const navigate = useNavigate();
    const { pathname } = useLocation();

    // Derive dashboard path from current base (/admin/dashboard or /login/dashboard)
    const base = pathname.startsWith("/login") ? "/login" : "/admin";
    const dashboardPath = `${base}/dashboard`;

    return (
        <div
            className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4"
            style={{ fontFamily: "'Nunito', sans-serif" }}
        >
            <div className="bg-white rounded-3xl border border-emerald-100 shadow-sm p-10 max-w-sm w-full space-y-5">
                <div className="h-16 w-16 mx-auto rounded-2xl bg-emerald-50 flex items-center justify-center">
                    <Construction className="w-8 h-8 text-emerald-600" />
                </div>
                <div className="space-y-2">
                    <h1 className="text-2xl font-black text-gray-900">{pageName}</h1>
                    <p className="text-sm font-semibold text-gray-500">
                        This feature is coming soon.
                    </p>
                    <p className="text-xs text-gray-400">
                        We're working hard to bring this to you.
                    </p>
                </div>
                <button
                    onClick={() => navigate(dashboardPath)}
                    className="inline-flex items-center gap-2 text-sm font-bold transition-colors"
                    style={{ color: "#2d9653" }}
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Dashboard
                </button>
            </div>
        </div>
    );
}
