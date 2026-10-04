import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getWall, isOptedOut } from "@/modules/wall/queries";
import WallFeed from "@/modules/wall/WallFeed";

/**
 * The Recognition Wall (Feature B) — what the people around you have done lately.
 *
 * Server-rendered so the wall is there on first paint rather than after a fetch — this
 * screen is pure recognition, and recognition that arrives late has already lost.
 */
export default async function WallPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [cards, optedOut] = await Promise.all([getWall(user), isOptedOut(user.id)]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-3xl font-bold text-text">The Wall</h1>
        <p className="mt-1 text-text-dim">
          What your group has done in the last two weeks. Nobody writes these — they are
          earned.
        </p>
      </div>

      <WallFeed initialCards={cards} viewerId={user.id} optedOut={optedOut} />
    </div>
  );
}
