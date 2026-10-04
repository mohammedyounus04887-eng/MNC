import { APP_TIMEZONE } from "./day";

/**
 * Threads — one-way broadcasts down a line (F8, v2 §6).
 *
 * ## What this feature is, and what it deliberately is not
 *
 * An upline writes one message and their line receives it. A downline can tap
 * acknowledge, and the sender watches that count rise. Any coach can re-broadcast
 * something they received to THEIR own line, which is how one message cascades
 * through thousands of people while every sender only ever writes to their own.
 *
 * It is NOT a chat. v1 §5.5 and RULES S3 forbid group chat outright, and the reason
 * is not squeamishness: two-way team chatter needs moderation, creates noise nobody
 * can catch up on, and WhatsApp already exists for it. So there is no reply, no
 * reaction, no mention, and no field on the document that could grow into one. The
 * only response a downline can make is "I saw this", and it is a number.
 *
 * PURE ONLY — no database import. `ThreadComposer` and `ThreadFeed` are client
 * components, and E2 exists because importing a queries module into a client file
 * pulls a server driver into the browser bundle.
 */

export const THREAD_SCOPES = ["direct", "all"] as const;
export type ThreadScope = (typeof THREAD_SCOPES)[number];

/**
 * The scope only Real V can send: everyone on the platform (F12's "broadcast announcement
 * to all users").
 *
 * Deliberately NOT a member of `THREAD_SCOPES`, and that is the whole safety design.
 * `THREAD_SCOPES` is what the composer renders and what `isThreadScope` accepts, so a
 * coach cannot select it and the coach-facing API rejects it without needing its own
 * check. The only way to write one is the admin-gated route.
 *
 * It reuses the thread machinery rather than adding an announcements banner because
 * coaches already know where threads live, already know the acknowledge tap, and the
 * seen/ack counters come free — which is exactly what you want to know after sending
 * something to every user.
 */
export const PLATFORM_SCOPE = "platform";

/**
 * Long enough for a real announcement, short enough to read standing up. The daily
 * log's note is 140 because it is a scribble; a broadcast is the one place a coach
 * writes something considered, so it gets more room than that and far less than an
 * essay nobody on a ₹10K phone will scroll.
 */
export const MAX_BODY = 1000;

/**
 * Two caps, because a URL changes length between being typed and being stored.
 *
 * `MAX_LINK_URL` bounds what a coach types, so an obviously-pasted-wrong monster is
 * refused immediately. `MAX_LINK_URL_STORED` bounds `new URL(...).toString()`, which
 * percent-encodes: 200 accented characters in a query arrive as 223 and leave as
 * ~1223, and four-byte characters push that multiplier to roughly six.
 *
 * Checking only the input made the cap describe a string nobody stores. But capping
 * the stored form at 500 too would refuse a perfectly ordinary link with Kannada or
 * Devanagari text in it — which this audience will paste — and tell them a
 * 223-character URL was "too long". So the stored ceiling is a realistic URL length
 * rather than the typing limit: generous enough for any legitimate encoded link,
 * still bounded.
 */
export const MAX_LINK_URL = 500;
export const MAX_LINK_URL_STORED = 2000;

export function isThreadScope(value: unknown): value is ThreadScope {
  return typeof value === "string" && (THREAD_SCOPES as readonly string[]).includes(value);
}

export const SCOPE_LABELS: Record<ThreadScope, string> = {
  direct: "My direct line only",
  all: "My whole line",
};

/** What the sender is told the choice means, in the words this audience uses. */
export const SCOPE_HELP: Record<ThreadScope, string> = {
  direct: "Only the coaches you brought in yourself.",
  all: "Everyone in your line, however deep it goes.",
};

export type BodyCheck = { ok: true; body: string } | { ok: false; error: string };

/**
 * Trims, then rejects empty and over-long. The trim matters: a body of only spaces
 * would otherwise send a blank card to a whole line, with a push notification.
 */
/**
 * Zero-width characters, which `trim()` does NOT remove.
 *
 * `String.prototype.trim` follows the ECMAScript WhiteSpace definition, and that
 * excludes U+200B..U+200D, U+2060 and U+FEFF. So a body of one zero-width space
 * survived the trim above and delivered exactly the blank card — plus a push
 * notification — to an entire line that the trim exists to prevent.
 *
 * Used ONLY to decide whether anything visible is present. The stored body keeps its
 * original characters, because U+200D (zero-width joiner) is meaningful in Devanagari
 * and Kannada conjuncts and in emoji sequences: stripping it from the text a coach
 * actually wrote would corrupt legitimate Indic spelling to fix a blank-message bug.
 */
const INVISIBLE_CODEPOINTS = new Set([
  0x200b, // ZERO WIDTH SPACE
  0x200c, // ZERO WIDTH NON-JOINER
  0x200d, // ZERO WIDTH JOINER
  0x2060, // WORD JOINER
  0xfeff, // ZERO WIDTH NO-BREAK SPACE / BOM
]);

/**
 * Codepoints rather than a regex literal, deliberately: a character class written with
 * the actual characters is invisible in the source, so nobody can review it and a
 * careless paste changes what it matches without showing a diff anyone can read.
 */
function hasVisibleContent(text: string): boolean {
  for (const ch of text) {
    if (INVISIBLE_CODEPOINTS.has(ch.codePointAt(0)!)) continue;
    if (/\s/.test(ch)) continue;
    return true;
  }
  return false;
}

export function checkBody(raw: unknown): BodyCheck {
  if (typeof raw !== "string") return { ok: false, error: "Write a message first." };
  const body = raw.trim();
  if (!hasVisibleContent(body)) {
    return { ok: false, error: "Write a message first." };
  }
  if (body.length > MAX_BODY) {
    return { ok: false, error: `Keep it under ${MAX_BODY} characters.` };
  }
  return { ok: true, body };
}

export type LinkCheck = { ok: true; linkUrl: string | null } | { ok: false; error: string };

/**
 * An optional link, and the validation is a security control rather than politeness.
 *
 * This URL is rendered as an anchor on every recipient's screen, so the scheme is an
 * allow-list of exactly `http` and `https`. `javascript:` is the obvious one to keep
 * out, but `data:` matters just as much — a `data:text/html` link opens attacker-authored
 * markup on our own origin's tab, and this is the one field in the app whose contents
 * are authored by one user and displayed to thousands of others.
 *
 * Parsing with `new URL` rather than a regex is deliberate: a regex on URLs is how
 * `https:/\/evil.com` gets through.
 */
export function checkLinkUrl(raw: unknown): LinkCheck {
  if (raw === undefined || raw === null || raw === "") return { ok: true, linkUrl: null };
  if (typeof raw !== "string") return { ok: false, error: "That link does not look right." };
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, linkUrl: null };
  if (trimmed.length > MAX_LINK_URL) return { ok: false, error: "That link is too long." };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Add a full link, starting with https://" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only https:// links can be shared." };
  }

  /**
   * Re-check the length on the NORMALISED string, because that is the one that gets
   * stored and rendered — `toString()` percent-encodes, so it can be several times
   * longer than what was typed. Measured: a 221-character input comes back at 1222,
   * and 4-byte characters push the multiplier to roughly 6×, so an input comfortably
   * inside the cap could store nearly 3000 characters.
   *
   * Checking the input alone made the cap describe something nobody stores.
   */
  const normalised = parsed.toString();
  if (normalised.length > MAX_LINK_URL_STORED) {
    return { ok: false, error: "That link is too long." };
  }
  return { ok: true, linkUrl: normalised };
}

/**
 * The attribution line on a re-broadcast.
 *
 * Always the ORIGINAL author, never the hop it arrived through. If Asha writes
 * something, Bhavana forwards it and Chetan forwards that, Chetan's line should read
 * "via Asha" — the person being trusted is whoever wrote it, and a chain of "via
 * Bhavana, via Asha" is both noise and a small map of somebody's team structure.
 */
export function attribution(originalSenderName: string | null): string | null {
  return originalSenderName ? `via ${originalSenderName}` : null;
}

/**
 * Whether a reader is in scope for a thread, given who sent it and where the reader
 * sits. The single place this rule is expressed for the app; `firestore.rules` states
 * the same thing independently, because a client must not be able to read what this
 * would have hidden.
 *
 * `uplinePath[0]` is the direct upline (D36), so "direct" is an equality check
 * against the nearest ancestor and "all" is membership anywhere in the chain.
 */
export function canRead(
  thread: { senderId: string; scope: string },
  reader: { id: string; uplineId: string | null; uplinePath: string[] }
): boolean {
  if (thread.senderId === reader.id) return true;
  // A platform announcement reaches every signed-in coach, whatever the tree says.
  if (thread.scope === PLATFORM_SCOPE) return true;
  if (thread.scope === "direct") return thread.senderId === reader.uplineId;
  return reader.uplinePath.includes(thread.senderId);
}

/**
 * "2 min ago" / "3 h ago" / "12 Aug". Threads are read newest-first and a coach cares
 * about "is this today", not the minute — so recent gets relative and older gets a
 * date, which is shorter to scan than a timestamp nobody reads.
 */
export function relativeTime(when: Date, now = new Date()): string {
  const seconds = Math.round((now.getTime() - when.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return when.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: APP_TIMEZONE,
  });
}

/**
 * How many people a sender is writing to, phrased so nobody has to parse a number
 * against a label. Zero is its own case: a coach with no line who taps send would
 * otherwise get a confident "Sent to 0 people".
 */
export function audienceLabel(count: number, scope: ThreadScope): string {
  if (count === 0) {
    return scope === "direct"
      ? "You have no direct line yet"
      : "You have nobody in your line yet";
  }
  const who = count === 1 ? "1 coach" : `${count} coaches`;
  return scope === "direct" ? `${who} in your direct line` : `${who} in your line`;
}
