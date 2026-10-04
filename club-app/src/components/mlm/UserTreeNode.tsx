import { useState } from "react";
import { ChevronDown, ChevronUp, User as UserIcon, Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TreeNode } from "@/hooks/useMLMTree";
import type { MemberType } from "@/types/firestore";

interface Props {
    node: TreeNode;
    isCurrentUser: boolean;
    onExpandToggle: (userId: string) => void;
    expandedNodes: Set<string>;
}

function getMemberTypeStyle(memberType?: MemberType): {
    border: string;
    bg: string;
    badgeClass: string;
    label: string;
} {
    switch (memberType) {
        case "visiting":
            return { border: "#f59e0b", bg: "#fffbeb", badgeClass: "bg-amber-100 text-amber-800 border-amber-300", label: "VISITING" };
        case "bronze":
            return { border: "#cd7f32", bg: "#fdf5ec", badgeClass: "bg-orange-100 text-orange-800 border-orange-300", label: "BRONZE" };
        case "silver":
            return { border: "#9ca3af", bg: "#f9fafb", badgeClass: "bg-gray-100 text-gray-800 border-gray-300", label: "SILVER" };
        case "gold":
            return { border: "#d97706", bg: "#fffbeb", badgeClass: "bg-yellow-100 text-yellow-800 border-yellow-300", label: "GOLD" };
        case "platinum":
            return { border: "#6366f1", bg: "#f5f3ff", badgeClass: "bg-indigo-100 text-indigo-800 border-indigo-300", label: "PLATINUM" };
        default:
            return { border: "#e2e8f0", bg: "#ffffff", badgeClass: "bg-slate-100 text-slate-800 border-slate-300", label: "" };
    }
}

export default function UserTreeNode({ node, isCurrentUser, onExpandToggle, expandedNodes }: Props) {
    const { user, children, depth } = node;
    const isExpanded = expandedNodes.has(user.id);
    const initials = user.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

    const typeStyle = getMemberTypeStyle((user as any).memberType as MemberType | undefined);
    const hasTypeColor = !!(user as any).memberType;

    return (
        <div className="flex flex-col items-center">
            {/* Node Content */}
            <Popover>
                <PopoverTrigger asChild>
                    <div
                        className="relative flex flex-col items-center p-3 rounded-2xl border-2 transition-all cursor-pointer hover:shadow-md w-40"
                        style={{
                            borderColor: isCurrentUser ? "#7c3aed" : typeStyle.border,
                            backgroundColor: isCurrentUser ? "#ffffff" : typeStyle.bg,
                        }}
                    >
                        {/* Avatar */}
                        <div
                            className="relative w-12 h-12 rounded-full border-2 flex items-center justify-center overflow-hidden flex-shrink-0"
                            style={{ borderColor: isCurrentUser ? "#7c3aed" : typeStyle.border }}
                        >
                            {user.photo ? (
                                <img src={user.photo} alt={user.name} className="w-full h-full object-cover" />
                            ) : (
                                <span className="font-bold text-slate-400 text-sm">{initials}</span>
                            )}
                            {user.isClubOwner && (
                                <div className="absolute -bottom-1 -right-1 bg-violet-600 text-white p-0.5 rounded-full z-10">
                                    <Building2 className="w-3 h-3" />
                                </div>
                            )}
                        </div>

                        {/* Labels */}
                        {isCurrentUser && (
                            <Badge className="absolute -top-3 bg-violet-600 border-none px-2 py-0.5 text-[10px]">You</Badge>
                        )}

                        <p className="mt-2 text-xs font-bold text-center leading-tight line-clamp-2 w-full">{user.name}</p>

                        {/* Member type badge */}
                        {hasTypeColor && typeStyle.label && (
                            <Badge
                                variant="outline"
                                className={`mt-1 text-[9px] py-0 px-1 border ${typeStyle.badgeClass}`}
                            >
                                {typeStyle.label}
                            </Badge>
                        )}

                        <div className="mt-2 w-full pt-2 border-t border-slate-100 text-center">
                            <p className="text-[9px] text-muted-foreground">
                                Joined {user.createdAt?.toDate().toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                            </p>
                            <p className="text-[10px] font-medium text-slate-700 mt-0.5">{children.length} in network</p>
                        </div>
                    </div>
                </PopoverTrigger>

                {/* Mini profile popover */}
                <PopoverContent className="w-60 p-4">
                    <div className="flex items-center gap-3 border-b pb-3 mb-3">
                        <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden border">
                            {user.photo ? (
                                <img src={user.photo} className="w-full h-full object-cover" />
                            ) : (
                                <UserIcon className="w-5 h-5 text-slate-400" />
                            )}
                        </div>
                        <div>
                            <p className="font-bold text-sm">{user.name}</p>
                            {(user as any).memberType && (
                                <p className="text-xs text-muted-foreground capitalize">{(user as any).memberType} Member</p>
                            )}
                        </div>
                    </div>
                    <div className="space-y-1.5 text-xs">
                        {(user as any).memberId && (
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Member ID</span>
                                <span className="font-bold font-mono">{(user as any).memberId}</span>
                            </div>
                        )}
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Network Size</span>
                            <span className="font-bold">{children.length}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Joined</span>
                            <span className="font-bold">{user.createdAt?.toDate().toLocaleDateString()}</span>
                        </div>
                        {user.dob && (
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Birthday</span>
                                <span className="font-bold">
                                    {(typeof user.dob?.toDate === 'function' ? user.dob.toDate() : new Date(user.dob as any)).toLocaleDateString("en-US", { month: "long", day: "numeric" })}
                                </span>
                            </div>
                        )}
                    </div>
                </PopoverContent>
            </Popover>

            {/* Children toggle */}
            {children.length > 0 && depth < 5 && (
                <button
                    onClick={() => onExpandToggle(user.id)}
                    className="mt-2 bg-white border rounded-full p-0.5 text-slate-500 hover:text-slate-800 hover:bg-slate-50 shadow-sm z-10"
                >
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
            )}

            {/* Too deep warning */}
            {children.length > 0 && depth >= 5 && isExpanded && (
                <div className="mt-2 text-[10px] text-muted-foreground font-medium bg-slate-100 px-2 py-1 rounded-full">
                    + {children.length} more
                </div>
            )}
        </div>
    );
}
