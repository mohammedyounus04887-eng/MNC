import { useState } from "react";
import UserTreeNode from "./UserTreeNode";
import type { TreeNode } from "@/hooks/useMLMTree";

interface Props {
    tree: TreeNode;
    currentUserId: string;
}

export default function TreeView({ tree, currentUserId }: Props) {
    // Start with root and its direct children expanded
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(
        new Set([tree.user.id])
    );

    const toggleExpand = (userId: string) => {
        setExpandedNodes(prev => {
            const next = new Set(prev);
            if (next.has(userId)) next.delete(userId);
            else next.add(userId);
            return next;
        });
    };

    const renderTree = (node: TreeNode) => {
        const hasChildren = node.children.length > 0;
        const isExpanded = expandedNodes.has(node.user.id);
        const showChildren = hasChildren && isExpanded && node.depth < 5;

        return (
            <div className="flex flex-col items-center relative" key={node.user.id}>
                <UserTreeNode
                    node={node}
                    isCurrentUser={node.user.id === currentUserId}
                    onExpandToggle={toggleExpand}
                    expandedNodes={expandedNodes}
                />

                {showChildren && (
                    <>
                        {/* Connecting line down from parent */}
                        <div className="w-[2px] h-6 bg-slate-300"></div>

                        <div className="flex gap-4 md:gap-8 pt-6 relative">
                            {/* Horizontal line connecting siblings */}
                            {node.children.length > 1 && (
                                <div
                                    className="absolute top-0 h-[2px] bg-slate-300 left-0 right-0"
                                    style={{
                                        // Adjust horizontal line width to span exactly from the center of the first child to the center of the last child
                                        left: `calc(50% / ${node.children.length})`,
                                        right: `calc(50% / ${node.children.length})`,
                                        width: `calc(100% - (100% / ${node.children.length}))`
                                    }}
                                />
                            )}

                            {/* Render children */}
                            {node.children.map((child) => (
                                <div key={child.user.id} className="relative flex flex-col items-center">
                                    {/* Small vertical line up to the horizontal connector */}
                                    <div className="absolute -top-6 w-[2px] h-6 bg-slate-300"></div>
                                    {renderTree(child)}
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>
        );
    };

    return (
        <div className="overflow-x-auto pb-12 pt-4 px-4 min-h-[60vh] flex justify-center">
            <div className="inline-flex min-w-max">
                {renderTree(tree)}
            </div>
        </div>
    );
}
