import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { Club } from "@/types/firestore";

export interface TreeNode extends Club {
    children: TreeNode[];
    memberCount?: number;
}

interface Props {
    node: TreeNode;
    level?: number;
}

export default function ClubTreeNode({ node, level = 0 }: Props) {
    const [expanded, setExpanded] = useState(level < 2);
    const navigate = useNavigate();
    const hasChildren = node.children.length > 0;

    const initials = node.name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

    return (
        <div className="relative">
            {/* Connecting line from parent */}
            {level > 0 && (
                <div
                    className="absolute -left-6 top-0 h-7 w-6 border-l-2 border-b-2 border-gray-200 rounded-bl-lg"
                    aria-hidden
                />
            )}

            {/* Node */}
            <div
                className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all hover:shadow-md ${node.status === "active"
                        ? "bg-white border-border"
                        : "bg-gray-50 border-gray-200 opacity-70"
                    }`}
                onClick={() => navigate(`/superadmin/clubs/${node.id}`)}
            >
                {/* Expand toggle */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setExpanded(!expanded);
                    }}
                    className={`w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:bg-gray-100 transition-colors ${!hasChildren ? "invisible" : ""
                        }`}
                >
                    {expanded ? (
                        <ChevronDown className="w-4 h-4" />
                    ) : (
                        <ChevronRight className="w-4 h-4" />
                    )}
                </button>

                {/* Avatar */}
                <Avatar className="h-8 w-8 rounded-lg">
                    {node.logo ? <AvatarImage src={node.logo} /> : null}
                    <AvatarFallback
                        className="rounded-lg text-[10px] font-bold text-white"
                        style={{ backgroundColor: node.primaryColor || "#8B5CF6" }}
                    >
                        {initials}
                    </AvatarFallback>
                </Avatar>

                {/* Info */}
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{node.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{node.domain}</p>
                </div>

                {/* Status dot */}
                <div
                    className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${node.status === "active" ? "bg-emerald-500" : "bg-red-400"
                        }`}
                    title={node.status}
                />
            </div>

            {/* Children */}
            {hasChildren && expanded && (
                <div className="ml-6 mt-2 space-y-2 relative">
                    {/* Vertical connecting line */}
                    <div
                        className="absolute left-0 top-0 bottom-4 border-l-2 border-gray-200"
                        aria-hidden
                        style={{ left: "-6px" }}
                    />
                    {node.children.map((child) => (
                        <ClubTreeNode key={child.id} node={child} level={level + 1} />
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Tree builder utility ───────────────────────────────────────────────

export function buildClubTree(clubs: Club[]): TreeNode[] {
    const map: Record<string, TreeNode> = {};
    const roots: TreeNode[] = [];

    clubs.forEach((club) => {
        map[club.id] = { ...club, children: [] };
    });

    clubs.forEach((club) => {
        if (club.parentClubId && map[club.parentClubId]) {
            map[club.parentClubId].children.push(map[club.id]);
        } else {
            roots.push(map[club.id]);
        }
    });

    return roots;
}
