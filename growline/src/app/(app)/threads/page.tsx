import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import {
  audienceCount,
  listInbox,
  listSent,
} from "@/lib/threads-queries";
import { relativeTime } from "@/lib/threads";
import { EmptyState } from "@/components/EmptyState";
import { ThreadsIcon } from "@/components/icons";
import RealtimeThreads from "@/components/RealtimeThreads";
import ThreadComposer from "./ThreadComposer";
import ThreadFeed, { type FeedThread } from "./ThreadFeed";

/**
 * Threads (F8) — one screen for both sides, like Targets.
 *
 * Most coaches are simultaneously somebody's downline and somebody's upline, so the
 * messages they received and the messages they sent belong together. Splitting them
 * would mean two tabs to do one round of evening work.
 *
 * Server-rendered and complete on its own. `RealtimeThreads` only asks Next to
 * refresh it when something changes; it is never the source of truth.
 */
export default async function ThreadsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [inbox, sent, directCount, lineCount] = await Promise.all([
    listInbox(user),
    listSent(user.id),
    audienceCount(user, "direct"),
    audienceCount(user, "all"),
  ]);

  const feed: FeedThread[] = inbox.map((t) => ({
    id: t.id,
    senderName: t.senderName,
    scope: t.scope,
    body: t.body,
    linkUrl: t.linkUrl,
    originalSenderName: t.originalSenderName,
    // Serialised for the client boundary; ThreadFeed re-hydrates with new Date().
    createdAt: t.createdAt.toISOString(),
    acked: t.acked,
  }));
  const unseenIds = inbox.filter((t) => !t.seen).map((t) => t.id);
  const unacked = inbox.filter((t) => !t.acked).length;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold">Threads</h1>
        {unacked > 0 && (
          <p className="mt-1 text-sm font-semibold text-gold-ink">
            {unacked === 1
              ? "1 message waiting for you"
              : `${unacked} messages waiting for you`}
          </p>
        )}
      </div>

      <RealtimeThreads uplineId={user.uplineId} unseenIds={unseenIds} />

      {feed.length > 0 ? (
        <ThreadFeed threads={feed} canForward={directCount > 0} />
      ) : (
        <EmptyState
          icon={<ThreadsIcon className="h-7 w-7" />}
          title="Messages from your upline appear here"
          body={
            user.uplineId
              ? "Announcements, motivation and techniques from your line — with one-tap acknowledge."
              : "Nobody is above you in your line, so nothing arrives here. Anything you send goes out below."
          }
        />
      )}

      <ThreadComposer directCount={directCount} lineCount={lineCount} />

      {sent.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">What you sent</h2>
          <ul className="flex flex-col gap-2">
            {sent.map((t) => (
              <li
                key={t.id}
                data-testid="sent-thread"
                className="rounded-xl bg-surface p-4"
              >
                <p className="line-clamp-2 text-sm">{t.body}</p>
                <p className="mt-2 text-sm text-text-dim">
                  {relativeTime(t.createdAt)} ·{" "}
                  {/* The two numbers an upline acts on. Seen is passive, acknowledged
                      is a deliberate tap — showing only the second would hide that a
                      message landed and was ignored, which is the useful signal. */}
                  <span data-testid="sent-seen">{t.seenCount} seen</span> ·{" "}
                  <span
                    data-testid="sent-ack"
                    className="font-semibold text-gold-ink"
                  >
                    {t.ackCount} acknowledged
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
