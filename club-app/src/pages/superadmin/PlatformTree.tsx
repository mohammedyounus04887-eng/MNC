import { GitBranch } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import ClubTreeNode, { buildClubTree } from "@/components/superadmin/ClubTreeNode";
import { useAllClubs } from "@/hooks/useSuperAdmin";

export default function PlatformTree() {
    const { data: clubs, isLoading } = useAllClubs();

    const tree = clubs ? buildClubTree(clubs) : [];

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                    <GitBranch className="w-6 h-6 text-violet-500" />
                    Platform Tree
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Visual hierarchy of all clubs in the MLM tree
                </p>
            </div>

            {/* Tree */}
            {isLoading ? (
                <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-14 rounded-xl" />
                    ))}
                </div>
            ) : tree.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                    <p>No clubs to display.</p>
                </div>
            ) : (
                <div className="space-y-3 max-w-2xl">
                    {tree.map((node) => (
                        <ClubTreeNode key={node.id} node={node} />
                    ))}
                </div>
            )}
        </div>
    );
}
