import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import {
  getDirectLineTargets,
  getMyTarget,
} from "@/lib/targets-queries";
import { currentMonth, monthLabel } from "@/lib/targets";
import TargetRing from "@/components/TargetRing";
import MyTargetCard from "./MyTargetCard";
import LineTargets from "./LineTargets";
import LevelNameField from "./LevelNameField";

/**
 * "My Target" (F7). One screen holds both sides of the relationship: the target this
 * coach was given, and the targets they set for their own direct line. Most coaches
 * are both a downline and an upline, so splitting them across two screens would mean
 * navigating twice to do one round of work.
 */
export default async function TargetsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const month = currentMonth();
  const [mine, line] = await Promise.all([
    getMyTarget(user.id, month),
    getDirectLineTargets(user.id, month),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl font-bold text-text">My Target</h1>
        <p className="mt-1 text-text-dim">{monthLabel(month)}</p>
      </div>

      {mine && (
        <TargetRing
          progress={mine.progressPoints}
          target={mine.targetPoints}
          month={mine.month}
        />
      )}

      <MyTargetCard
        target={
          mine
            ? {
                id: mine.id,
                targetPoints: mine.targetPoints,
                progressPoints: mine.progressPoints,
                status: mine.status,
                setByName: mine.setBy.name,
                proofs: mine.proofs.map((p) => ({
                  ...p,
                  createdAt: p.createdAt.toISOString(),
                })),
              }
            : null
        }
        levelName={user.levelName}
      />

      <LevelNameField levelName={user.levelName} />

      {line.length > 0 && (
        <LineTargets
          month={month}
          rows={line.map((row) => ({
            coach: row.coach,
            target: row.target
              ? {
                  id: row.target.id,
                  targetPoints: row.target.targetPoints,
                  progressPoints: row.target.progressPoints,
                  status: row.target.status,
                  proofs: row.target.proofs.map((p) => ({
                    ...p,
                    createdAt: p.createdAt.toISOString(),
                  })),
                }
              : null,
          }))}
        />
      )}
    </div>
  );
}
