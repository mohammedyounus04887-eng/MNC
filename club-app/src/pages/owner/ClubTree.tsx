import { useState, useEffect } from "react";
import { GitBranch, Users, Globe, ChevronDown, ChevronRight, Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useClubTree } from "@/hooks/owner/useClubTree";
import { useClubContext } from "@/lib/clubDetection";
import { useMemberCountByClub } from "@/hooks/useSuperAdmin";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import TreeView from "@/components/mlm/TreeView";
import type { TreeNode as MLMTreeNode } from "@/hooks/useMLMTree";
import type { Club, User } from "@/types/firestore";

interface ClubTreeNode {
    club: Club;
    memberCount: number;
    children: ClubTreeNode[];
}

function TreeNode({ node, depth }: { node: ClubTreeNode; depth: number }) {
    const [open, setOpen] = useState(depth < 2);
    const hasChildren = node.children.length > 0;
    const c = node.club;

    return (
        <div style={{ paddingLeft: depth > 0 ? 32 : 0 }} className={depth > 0 ? "relative" : ""}>
            {depth > 0 && (
                <div
                    className="absolute -left-6 top-0 h-7 w-6 border-l-2 border-b-2 border-gray-200 rounded-bl-lg"
                    aria-hidden
                />
            )}
            <div className="flex items-start gap-2 py-2">
                {hasChildren ? (
                    <button
                        onClick={() => setOpen(!open)}
                        className="mt-1.5 p-0.5 rounded hover:bg-gray-100 text-muted-foreground"
                    >
                        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                ) : (
                    <span className="w-5" />
                )}
                <div className="flex-1 min-w-0 rounded-xl border bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold text-base">{c.name}</p>
                        <Badge
                            variant={c.status === "active" ? "default" : "destructive"}
                            className={`text-xs ${c.status === "active" ? "!bg-[#2d9653] !border-[#2d9653]" : ""}`}
                        >
                            {c.status}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                            <Users className="w-3 h-3 mr-1" />
                            {node.memberCount} members
                        </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                        <Building2 className="w-3.5 h-3.5" /> {c.ownerName}
                    </p>
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Globe className="w-3.5 h-3.5" /> {c.domain}
                    </p>
                </div>
            </div>
            {open && hasChildren && (
                <div className="relative ml-2" style={{ borderLeft: "2px solid #e5e7eb", marginLeft: 12 }}>
                    {node.children.map((child) => (
                        <TreeNode key={child.club.id} node={child} depth={depth + 1} />
                    ))}
                </div>
            )}
        </div>
    );
}

function useMemberTree(clubId: string | null) {
    const [tree, setTree] = useState<MLMTreeNode | null>(null);
    const [loading, setLoading] = useState(true);
    const [totalCount, setTotalCount] = useState(0);

    useEffect(() => {
        if (!clubId) return;
        const fetch = async () => {
            try {
                const snap = await getDocs(collection(db, `clubs/${clubId}/members`));
                const allMembers = snap.docs.map(d => ({ id: d.id, ...d.data() } as User));
                setTotalCount(allMembers.length);

                // Find root: the club owner
                const owner = allMembers.find(m => m.isClubOwner);
                const rootUser = owner || allMembers[0];
                if (!rootUser) { setLoading(false); return; }

                const buildTree = (user: User, depth: number): MLMTreeNode => {
                    const children = allMembers.filter(m => m.parentUserId === user.id && m.id !== user.id);
                    return { user, depth, children: children.map(c => buildTree(c, depth + 1)) };
                };

                // Build tree from root, then attach orphans (no parentUserId or not in tree) as root-level children
                const rootNode = buildTree(rootUser, 0);

                // Collect all IDs already in tree
                const inTree = new Set<string>();
                const walk = (n: MLMTreeNode) => { inTree.add(n.user.id); n.children.forEach(walk); };
                walk(rootNode);

                // Orphans: members not in tree
                const orphans = allMembers.filter(m => !inTree.has(m.id));
                orphans.forEach(m => {
                    rootNode.children.push({ user: m, depth: 1, children: [] });
                });

                setTree(rootNode);
            } catch (e) {
                console.error("Member tree fetch error:", e);
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [clubId]);

    return { tree, loading, totalCount };
}

export default function ClubTree() {
    const { club } = useClubContext();
    const { data: children, isLoading } = useClubTree(club?.id ?? null);
    const { data: memberCount } = useMemberCountByClub(club?.id ?? "");
    const { tree: memberTree, loading: memberTreeLoading, totalCount } = useMemberTree(club?.id ?? null);
    const [tab, setTab] = useState<"clubs" | "members">("members");

    if (!club) return null;

    return (
        <div
            className="min-h-screen px-4 md:px-6 py-8 overflow-x-auto"
            style={{ fontFamily: "'Nunito', sans-serif" }}
        >
            <div className="max-w-3xl mx-auto">
                <header className="flex items-center gap-2 mb-6">
                    <GitBranch className="w-7 h-7" style={{ color: "#2d9653" }} />
                    <h1 className="text-2xl font-black" style={{ color: "#2d9653" }}>
                        Club Network
                    </h1>
                </header>

                <div
                    className="rounded-2xl border-2 p-6 mb-8"
                    style={{ borderColor: "#2d9653", backgroundColor: "rgba(45, 150, 83, 0.05)" }}
                >
                    <p className="text-xl font-bold">{club.name}</p>
                    <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                        <Building2 className="w-4 h-4" /> {club.ownerName}
                    </p>
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Globe className="w-4 h-4" /> {club.domain}
                    </p>
                    <Badge variant="secondary" className="mt-2">
                        <Users className="w-3.5 h-3.5 mr-1" />
                        {memberCount ?? 0} active members
                    </Badge>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 mb-6 bg-gray-100 rounded-2xl p-1 w-fit">
                    {([
                        { value: "members" as const, label: "👥 Member Tree" },
                        { value: "clubs" as const, label: "🏢 Child Clubs" },
                    ]).map((t) => (
                        <button
                            key={t.value}
                            onClick={() => setTab(t.value)}
                            className={`px-5 py-2 rounded-xl text-sm font-bold transition-all ${tab === t.value ? "bg-white shadow text-gray-800" : "text-gray-500 hover:text-gray-700"}`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                {tab === "members" ? (
                    <>
                        <div className="flex items-center gap-2 mb-4">
                            <h2 className="text-lg font-semibold">Member Referral Tree</h2>
                            <Badge variant="secondary">{totalCount} members</Badge>
                        </div>
                        {memberTreeLoading ? (
                            <div className="space-y-3">
                                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
                            </div>
                        ) : !memberTree ? (
                            <p className="text-muted-foreground py-8 text-center">No members found</p>
                        ) : (
                            <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
                                <div className="bg-slate-50/50">
                                    <TreeView tree={memberTree} currentUserId={club.ownerUserId} />
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <>
                        <h2 className="text-lg font-semibold mb-4">Child Clubs</h2>
                        {isLoading ? (
                            <div className="space-y-3">
                                {[1, 2, 3].map((i) => (
                                    <Skeleton key={i} className="h-24 rounded-xl" />
                                ))}
                            </div>
                        ) : !children || children.length === 0 ? (
                            <p className="text-muted-foreground py-8 text-center">No child clubs in your network</p>
                        ) : (
                            <div className="space-y-1">
                                {children.map((node) => (
                                    <TreeNode key={node.club.id} node={node} depth={0} />
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
