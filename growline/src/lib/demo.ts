/**
 * Demo mode — sign in as a seeded coach with no SMS, and switch roles in one tap.
 *
 * ## Why this is NOT an authentication bypass
 *
 * It would be easy, and wrong, to add a "skip auth" branch to the session check. Then
 * every screen would be running a code path that production never runs, the demo would
 * prove nothing about the real app, and the branch would live inside the one function
 * that must never have a way around it.
 *
 * Instead this mints a REAL session for a real seeded user: custom token → ID token →
 * session cookie, exactly the objects the SMS flow produces. Downstream, nothing knows
 * the difference — the same Security Rules apply, the same queries run, the same privacy
 * toggle governs what an upline can see. The only thing skipped is the SMS step.
 *
 * That is also what makes it a HONEST demo: what an investor sees is the product, not a
 * mock of it.
 *
 * ## The gate
 *
 * One environment variable, `DEMO_MODE`. Unset — which is what production is — and the
 * demo routes return 404 and no demo UI renders anywhere. There is no second way in, no
 * query parameter, no header, and no "unless localhost" cleverness that could be wrong
 * about where it is running.
 *
 * The uid is never taken from the request. It is looked up from the fixed table below,
 * so even with demo mode on, this cannot be used to mint a session for an arbitrary
 * account.
 *
 * **Never set DEMO_MODE on the real production deployment.** It is documented in
 * .env.example and logged loudly at boot.
 */

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "1" || process.env.DEMO_MODE === "true";
}

export type DemoRoleKey = "senior" | "middle" | "new";

export type DemoRole = {
  key: DemoRoleKey;
  /** A seeded uid from scripts/seed-sqlite.ts. Fixed, never from the request. */
  uid: string;
  name: string;
  /** What this role is for, in the words you would use introducing the screen. */
  headline: string;
  shows: string;
};

/**
 * Three seats, chosen to tell the whole story in three taps.
 *
 * The seeded tree is Root → Asha → Chandan, plus Bhavana under Root. So:
 *
 *   senior  sees a team underneath them and sets the targets
 *   middle  is BOTH a downline and an upline — the position most coaches are actually
 *           in, and the only one where you can show both halves of the relationship
 *   new     receives a target somebody else set, which is the view an upline is
 *           usually trying to explain
 */
export const DEMO_ROLES: DemoRole[] = [
  {
    key: "senior",
    uid: "usr_root0000000000000000",
    name: "Root Coach",
    headline: "Senior coach, with a team",
    shows: "The whole line, everyone's activity, and setting targets for the team.",
  },
  {
    key: "middle",
    uid: "usr_asha0000000000000000",
    name: "Asha",
    headline: "Coach with a downline",
    shows:
      "Both sides at once: her own prospects and daily work, plus the coach below her.",
  },
  {
    key: "new",
    uid: "usr_chan0000000000000000",
    name: "Chandan",
    headline: "New coach",
    shows: "What a target looks like from the receiving end, and a first prospect list.",
  },
];

export function demoRole(key: unknown): DemoRole | null {
  if (typeof key !== "string") return null;
  return DEMO_ROLES.find((r) => r.key === key) ?? null;
}

/** The role currently signed in, matched by uid, for the switcher's own label. */
export function demoRoleForUid(uid: string): DemoRole | null {
  return DEMO_ROLES.find((r) => r.uid === uid) ?? null;
}
