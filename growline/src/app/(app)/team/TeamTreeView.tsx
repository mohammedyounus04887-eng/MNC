"use client";

import Link from "next/link";
import { useState } from "react";
import type { TeamNode } from "@/lib/team";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/EmptyState";
import InviteButtons from "@/components/InviteButtons";
import { BackIcon, ChevronIcon, TeamIcon } from "@/components/icons";

function StatsBadges({ node }: { node: TeamNode }) {
  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <span className="text-sm">
        <b>{node.logsThisMonth}</b>
        <span className="text-text-dim"> logs</span>
      </span>
      {/* The live half of F6's loop: whether they have logged today, right now.
          Absence is stated plainly rather than shown in red — this is a nudge for
          the upline to respond to, not a mark against the person. */}
      <span
        className={`text-xs ${
          node.loggedToday ? "font-semibold text-gem-green" : "text-text-dim"
        }`}
      >
        {node.loggedToday ? "Logged today" : "Not logged today"}
      </span>
      {node.targetPct !== null && (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            node.targetPct >= 100
              ? "bg-elevated text-gem-green"
              : "bg-elevated text-gold-ink"
          }`}
        >
          Target {node.targetPct}%
        </span>
      )}
    </span>
  );
}

function TreeNode({
  node,
  depth,
  onDrill,
}: {
  node: TeamNode;
  depth: number;
  onDrill: (node: TeamNode) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const expandable = node.children.length > 0;

  return (
    <li>
      <div className="flex min-h-16 items-center gap-3 rounded-xl bg-surface p-3">
        <Avatar name={node.name} photoUrl={node.photoUrl} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{node.name}</p>
          <p className="truncate text-xs text-text-dim">
            {node.city ?? ""}
            {node.directCount > 0 &&
              `${node.city ? " · " : ""}${node.directCount} in line`}
          </p>
        </div>
        <StatsBadges node={node} />
        {expandable && (
          <button
            aria-label={open ? "Collapse" : "Expand"}
            onClick={() => setOpen(!open)}
            className="flex h-12 w-10 items-center justify-center text-text-dim"
          >
            <ChevronIcon className={`h-5 w-5 transition-transform ${open ? "rotate-90" : ""}`} />
          </button>
        )}
        {node.hasMore && (
          <button
            onClick={() => onDrill(node)}
            className="h-12 shrink-0 rounded-xl bg-elevated px-3 text-sm font-semibold text-gold-ink"
          >
            View team
          </button>
        )}
      </div>
      {expandable && open && (
        <ul className="ml-5 mt-2 flex flex-col gap-2 border-l-2 border-navy-100 pl-3">
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} onDrill={onDrill} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function TeamTreeView({
  initialTree,
  inviteCode,
}: {
  initialTree: TeamNode;
  inviteCode: string;
}) {
  const [tree, setTree] = useState(initialTree);
  const [crumbs, setCrumbs] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async (rootId: string, nextCrumbs: { id: string; name: string }[]) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/team?root=${rootId}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not load that team.");
        return;
      }
      setTree(data.tree);
      setCrumbs(nextCrumbs);
    } catch {
      setError("No connection. Check your network and try again.");
    } finally {
      setLoading(false);
    }
  };

  const drill = (node: TeamNode) =>
    void load(node.id, [...crumbs, { id: tree.id, name: tree.name }]);

  const back = () => {
    const prev = crumbs[crumbs.length - 1];
    if (prev) void load(prev.id, crumbs.slice(0, -1));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">My Team</h1>
        <Link
          href="/targets"
          className="flex h-12 items-center rounded-xl border border-hairline px-4 font-medium"
        >
          Targets
        </Link>
      </div>

      {crumbs.length > 0 && (
        <button
          onClick={back}
          className="flex h-12 items-center gap-2 self-start font-medium text-gold-ink"
        >
          <BackIcon className="h-5 w-5" />
          Back to {crumbs[crumbs.length - 1].name.split(" ")[0]}
        </button>
      )}

      {error && (
        <p className="rounded-xl bg-elevated px-4 py-3 text-sm text-heat">{error}</p>
      )}

      {loading ? (
        <div className="flex flex-col gap-2" aria-label="Loading">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-surface" />
          ))}
        </div>
      ) : (
        <>
          {/* Root card — me (or the downline being viewed) at top */}
          <div className="flex min-h-16 items-center gap-3 rounded-2xl bg-elevated p-4 text-text">
            <Avatar name={tree.name} photoUrl={tree.photoUrl} size={52} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold">{tree.name}</p>
              <p className="truncate text-sm text-text-dim">
                {tree.city ?? ""}
                {tree.directCount > 0 &&
                  `${tree.city ? " · " : ""}${tree.directCount} direct`}
              </p>
            </div>
            <span className="flex flex-col items-end gap-1">
              <span className="text-sm">
                <b>{tree.logsThisMonth}</b>
                <span className="text-text-dim"> logs this month</span>
              </span>
              <span
                className={`text-xs ${
                  tree.loggedToday ? "font-semibold text-gold-ink" : "text-text-dim"
                }`}
              >
                {tree.loggedToday ? "Logged today" : "Not logged today"}
              </span>
              {tree.targetPct !== null && (
                <span className="rounded-full bg-gold px-2 py-0.5 text-xs font-semibold text-on-gold">
                  Target {tree.targetPct}%
                </span>
              )}
            </span>
          </div>

          {tree.children.length === 0 ? (
            <EmptyState
              icon={<TeamIcon className="h-7 w-7" />}
              title="Your line starts here"
              body="Share your invite — every coach who signs up with your code appears in this tree, and you'll see their daily work roll up."
            >
              {crumbs.length === 0 && <InviteButtons code={inviteCode} />}
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {tree.children.map((child) => (
                <TreeNode key={child.id} node={child} depth={1} onDrill={drill} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
