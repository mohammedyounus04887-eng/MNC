import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { buildTeamTree } from "@/lib/team";
import { pendingForUser } from "@/lib/line-requests";
import TeamTreeView from "./TeamTreeView";
import LinkLine, { type PendingRequest } from "./LinkLine";

export default async function TeamPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [tree, requests] = await Promise.all([
    buildTeamTree(user.id),
    pendingForUser(user.id),
  ]);
  if (!tree) redirect("/login");

  const pending: PendingRequest[] = requests.map((req) => ({
    id: req.id,
    childName: req.childId === user.id ? "You" : req.childName,
    parentName: req.parentId === user.id ? "you" : req.parentName,
    // The approver is whoever did NOT ask. Decided on the server so the client cannot
    // show itself an Accept button for a request it is not entitled to answer — the API
    // re-checks anyway, but a button that always fails is its own bug.
    mineToAnswer: req.requestedBy !== user.id,
    iAmTheChild: req.childId === user.id,
  }));

  return (
    <div className="flex flex-col gap-5">
      <TeamTreeView initialTree={tree} inviteCode={user.referralCode} />
      <LinkLine hasUpline={user.uplineId !== null} pending={pending} />
    </div>
  );
}
