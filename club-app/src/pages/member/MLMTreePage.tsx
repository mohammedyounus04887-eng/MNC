import { useState } from "react";
import { GitBranch, List, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { useMyTree } from "@/hooks/useMLMTree";
import TreeView from "@/components/mlm/TreeView";

export default function MLMTreePage() {
    const { firebaseUser } = useAuth();
    const { tree, totalNetworkCount, directReferrals, loading } = useMyTree();
    const [viewMode, setViewMode] = useState<"tree" | "list">("tree");

    if (loading) {
        return (
            <div className="space-y-6 animate-fade-in p-6">
                <Skeleton className="h-20 w-full rounded-2xl" />
                <Skeleton className="h-96 w-full rounded-2xl" />
            </div>
        );
    }

    // To build list view, we just flatten the tree
    const flattenTree = (node: any): any[] => {
        let list = [node.user];
        for (const child of node.children) {
            list = list.concat(flattenTree(child));
        }
        return list;
    };

    const flatList = tree ? flattenTree(tree).filter(u => u.id !== firebaseUser?.uid) : [];
    // Sort by join date descending
    flatList.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

    return (
        <div className="space-y-6 animate-fade-in px-4 md:px-6 pb-20">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
                        <Network className="w-6 h-6 text-violet-600" /> My Network
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">View your connected downline structure and total impact.</p>
                </div>

                <div className="flex bg-slate-100 p-1 rounded-xl">
                    <button
                        onClick={() => setViewMode("tree")}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${viewMode === "tree" ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
                    >
                        <GitBranch className="w-4 h-4" /> Tree View
                    </button>
                    <button
                        onClick={() => setViewMode("list")}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${viewMode === "list" ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
                    >
                        <List className="w-4 h-4" /> List View
                    </button>
                </div>
            </div>

            {/* Summary Bar */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-center">
                    <p className="text-3xl font-black text-violet-600">{totalNetworkCount}</p>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-1">Total Network</p>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-center">
                    <p className="text-3xl font-black text-slate-900">{directReferrals}</p>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-1">Direct Referrals</p>
                </div>
            </div>

            {tree && firebaseUser ? (
                <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
                    {viewMode === "tree" ? (
                        <div className="bg-slate-50/50">
                            <TreeView tree={tree} currentUserId={firebaseUser.uid} />
                        </div>
                    ) : (
                        <div className="divide-y">
                            {flatList.length === 0 ? (
                                <p className="p-8 text-center text-slate-500 text-sm">No one in your network yet.</p>
                            ) : (
                                flatList.map(user => (
                                    <div key={user.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                                        <div className="flex items-center gap-3">
                                            <Avatar
                                                className="h-10 w-10 border-2"
                                                style={{
                                                    borderColor: user.memberType === "visiting" ? "#f59e0b"
                                                        : user.memberType === "bronze" ? "#cd7f32"
                                                            : user.memberType === "silver" ? "#9ca3af"
                                                                : user.memberType === "gold" ? "#d97706"
                                                                    : user.memberType === "platinum" ? "#6366f1"
                                                                        : "#e2e8f0"
                                                }}
                                            >
                                                {user.photo ? <AvatarImage src={user.photo} /> : <AvatarFallback className="font-bold text-xs bg-violet-100 text-violet-800">{user.name[0]}</AvatarFallback>}
                                            </Avatar>
                                            <div>
                                                <p className="font-bold text-sm text-slate-900">{user.name}</p>
                                                <p className="text-xs text-slate-500">Joined {user.createdAt?.toDate().toLocaleDateString()}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {user.memberType && (
                                                <Badge
                                                    variant="outline"
                                                    className="text-xs capitalize"
                                                    style={{
                                                        borderColor: user.memberType === "visiting" ? "#f59e0b"
                                                            : user.memberType === "bronze" ? "#cd7f32"
                                                                : user.memberType === "silver" ? "#9ca3af"
                                                                    : user.memberType === "gold" ? "#d97706"
                                                                        : user.memberType === "platinum" ? "#6366f1"
                                                                            : undefined,
                                                        color: user.memberType === "visiting" ? "#92400e"
                                                            : user.memberType === "bronze" ? "#7c3b00"
                                                                : user.memberType === "silver" ? "#374151"
                                                                    : user.memberType === "gold" ? "#92400e"
                                                                        : user.memberType === "platinum" ? "#3730a3"
                                                                            : undefined,
                                                    }}
                                                >
                                                    {user.memberType}
                                                </Badge>
                                            )}
                                            {((user as any).shakeCredits ?? 0) > 0 && (
                                                <Badge variant="outline" className="text-xs">
                                                    {(user as any).shakeCredits} credits
                                                </Badge>
                                            )}
                                        </div>
                                    </div>

                                ))
                            )}
                        </div>
                    )}
                </div>
            ) : null}
        </div>
    );
}
