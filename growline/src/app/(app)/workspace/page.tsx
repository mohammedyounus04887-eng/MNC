import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import {
  countWorkspaceMembers,
  getWorkspace,
} from "@/modules/workspaces/queries";
import WorkspaceSettings, {
  type WorkspaceView,
} from "@/modules/workspaces/WorkspaceSettings";

/**
 * The organisation screen: `/workspace`.
 *
 * Server-rendered, and the workspace is resolved from the signed-in coach's own account
 * rather than from anything in the URL — there is no `/workspace/[id]`, deliberately. A
 * workspace id in a route is a workspace id somebody can edit, and the whole point of this
 * feature is that a coach cannot address another organisation at all.
 *
 * NOT yet reachable from the navigation. The bottom bar is full at five tabs and adding a
 * sixth is the owner's call, not this session's — the same position `/voice-log` and
 * `/who-to-call` are in, and it is recorded in STATUS.md rather than left to be discovered.
 */
export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const workspace = user.workspaceId ? await getWorkspace(user.workspaceId) : null;

  /**
   * A coach with no workspace is a row the backfill has not reached. Say so plainly and
   * name the fix, rather than rendering an empty screen — every workspace-scoped query
   * returns nothing for them, so a blank page here would be the least informative symptom
   * of a problem with a one-command remedy.
   */
  if (!workspace) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-3xl font-bold">Your group</h1>
        <section className="rounded-2xl bg-surface p-5">
          <p className="font-medium">You are not in a group yet.</p>
          <p className="mt-2 text-sm text-text-dim">
            Nothing is lost — your prospects, logs and targets are all still yours. Group
            features stay empty until an admin runs the one-off setup.
          </p>
        </section>
      </div>
    );
  }

  const memberCount = await countWorkspaceMembers(workspace.id);
  const view: WorkspaceView = {
    id: workspace.id,
    name: workspace.name,
    accent: workspace.accent,
    levelGroups: workspace.levelGroups,
    memberCount,
    // Decided on the server from the workspace's own ownerId, so the client cannot show
    // itself an editable form it has no right to submit. The route re-checks anyway.
    isOwner: workspace.ownerId === user.id,
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl font-bold">Your group</h1>
        <p className="mt-1 text-text-dim">
          Everything in Growline — your team, boards and targets — stays inside this group.
        </p>
      </div>
      <WorkspaceSettings workspace={view} />
    </div>
  );
}
