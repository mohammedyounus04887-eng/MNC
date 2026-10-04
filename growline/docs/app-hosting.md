# App Hosting deployment

The full reasoning that used to live as comments in `apphosting.yaml`, moved here
after nine consecutive rollouts failed at the preparer with
`fah/invalid-apphosting-yaml`. The yaml now stays within the constructs the official
reference shows verbatim; this file carries everything else.

## Why App Hosting and not classic Hosting

Classic Hosting's framework integration pins `12 - 16.0` against our `next@16.3.0`
(D79). App Hosting builds from a git push against the connected branch (`master`);
`firebase deploy --only hosting` is not a command that exists for this app, and
`firebase.json` has no hosting block on purpose.

## The build

`package.json`'s `build` script is `prisma generate && next build`. The generate
step is not decoration: a clean checkout fails `next build` without it, because
type-checking reaches `scripts/migrate-to-firestore.ts`, which imports the generated
Prisma client. CI runs generate as its own step; App Hosting runs it via the build
script. `DATABASE_URL` (BUILD-only) exists solely so prisma can read its config —
nothing at runtime opens that file.

## Why there are no secrets

A `secret:` entry is a hard reference — absent from Secret Manager, the whole
rollout fails. The app needs none to boot: on Cloud Run the Admin SDK uses the
revision's own attached service account via Application Default Credentials,
accepted by the boot guard when `K_SERVICE` proves the platform (D80). An explicit
`FIREBASE_SERVICE_ACCOUNT` env var still wins if ever set — use that only to point
the backend at a different project than the one hosting it.

## What is switched off at launch, and what each absence costs

| Missing | Effect while absent |
|---|---|
| `CRON_SECRET` (Secret Manager, used by Cloud Functions) | all nine background jobs refuse to run — boards look broken rather than empty |
| `ADMIN_UIDS` | `/admin` is closed to everyone, including the owner (correct default) |
| `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY` | App Check attests nothing; do NOT enforce in the console until the key ships |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` | `isPushConfigured()` is false; morning reminders silently never send |
| `RAZORPAY_*` (all five) | money routes refuse cleanly; `/plans` shows the launch-open banner (RULES L7 holds regardless) |
| `PRIVACY_*` (all four) | `/privacy` 404s and nothing links it — required before real prospects |

Add each by creating the secret first (`firebase apphosting:secrets:set NAME`), then
adding the env entry to `apphosting.yaml` in the same change. Never give a secret
BUILD availability — a secret exposed to the build is a secret in the build logs.

**`value: ""` is not a valid way to stage a variable** — to a Go validator an empty
string is indistinguishable from unset, so the entry reads as an env var with
neither value nor secret and the preparer rejects the entire file. Absent means off.

## NEXT_PUBLIC_* and rollouts

Next inlines `NEXT_PUBLIC_*` into the client bundle at BUILD time. Changing one in
the console or in the yaml takes effect on the NEXT rollout, not the current one; a
value that resolves empty is baked in as `undefined` and fails silently — the
browser simply talks to nothing.

## Emulator hosts

`FIRESTORE_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR_HOST` must never appear here.
Either one in production makes the Admin SDK stop verifying tokens while data goes
somewhere else; the boot guard throws on every half-set combination by design.
