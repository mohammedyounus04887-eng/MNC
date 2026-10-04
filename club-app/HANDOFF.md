# HANDOFF — mobile ↔ PC round-trip test

This file is the baton. Whoever finishes a stretch of work writes the last
entry; whoever picks it up next reads the last entry first.

Branch under test: `claude/mobile-pc-workflow-test-alhnwl`

---

## The round-trip test

Three legs. Each leg is done from a different place. If all three land, the
flow works and we can trust it for real work.

- [x] **Leg 1 — phone → cloud.** Asked from the phone, ran in a Claude Code
      web session, wrote this file, pushed to the branch. (Done, see entry
      below.)
- [ ] **Leg 2 — cloud → PC.** On the PC:
      ```bash
      git fetch origin claude/mobile-pc-workflow-test-alhnwl
      git checkout claude/mobile-pc-workflow-test-alhnwl
      git pull
      ```
      Then fill in the PC line in the log table below, commit, push.
- [ ] **Leg 3 — PC → phone.** From the phone, ask this session (or a new one)
      to pull and read the file back. If it can read the line the PC wrote,
      the loop is closed.

---

## Handoff log

Append a row every time you hand the work over. Newest at the bottom.

| # | From | What was done | Where it stopped / what's next |
|---|------|---------------|-------------------------------|
| 1 | Phone → Claude Code web | Pulled both repos, created this file on the test branch, pushed. | Waiting on Leg 2 — PC needs to pull and add row 2. |
| 2 | PC | _(fill this in from the PC — even one line is enough)_ | |

---

## Rules that keep this from breaking

1. **One branch at a time.** Both devices work on the same branch. Do not
   start a second branch for the same task — that is how the two copies drift.
2. **Pull before you touch anything.** Every session, both devices, no
   exceptions. `git pull` costs two seconds; a conflict costs an evening.
3. **Push before you put the device down.** Uncommitted work on a PC that is
   sitting at home is work the phone cannot see. The cloud session's container
   is wiped when it goes idle, so unpushed work there is simply gone.
4. **Phone decides, PC verifies.** Anything that needs a running app, a build,
   a device, or a real look at the screen belongs on the PC. Everything else —
   planning, reading, writing code, reviewing, small fixes — is fine from the
   phone.
5. **Write the handoff row before you stop.** Future-you on the other device
   has none of the context current-you has.
6. **Push after every change, however small.** Not once at the end of a session —
   after *each* discrete change, as it is finished. A file written, a bug fixed,
   a script proven to run: commit it and push it, then carry on. Never batch a
   session's work into one commit at the end.

   Two reasons, and the second is the one that bites. An hour of unpushed work
   is an hour a reclaimed container can delete. And a single fat commit is
   unreviewable from a phone — small commits are the only way the other device
   can actually see what changed.

   This also means pushing *before* asking a question: a question can wait in a
   chat window for hours, but unpushed work cannot. Never end a turn holding it.

---

## What this repo needs a PC for

Keep these on the PC leg — they cannot be confirmed from a phone session:

- `npm run build` against real Firebase, and the deploy
  (`npx firebase deploy --only hosting`).
- Hard-refreshing the PWA after a deploy to confirm the new code actually
  loaded (the app caches itself).
- Anything touching Firestore rules or Cloud Functions — per `CLAUDE.md`,
  those do not ship without the owner present.
- Looking at a screen on a real device: reception, kitchen, member app.

Everything else — typecheck, tests, reading code, writing code, reviews —
runs fine in a cloud session started from the phone.

---

## Deploying

Merging to `main` deploys hosting. `.github/workflows/deploy-hosting.yml` runs the
tests, builds, and ships — so a fix can go out from a phone.

**Hosting only, on purpose.** Firestore rules and Cloud Functions are never
deployed by CI. `CLAUDE.md`: one rule too strict stops the club mid-service, so
that stays a decision somebody makes at a keyboard.

**One-time setup, and it will not work until this is done:**
Repo → Settings → Secrets and variables → Actions → New repository secret
- `FIREBASE_SERVICE_ACCOUNT` — the whole JSON from Firebase Console → Project
  Settings → Service Accounts → Generate new private key

Optional, as a repo *variable* rather than a secret:
- `VITE_FIREBASE_VAPID_KEY` — the VAPID public key. Without it the notifications
  toggle stays disabled; nothing else breaks.

**After a deploy, hard refresh.** The app is a PWA and caches itself, so a device
keeps serving the old code until Ctrl+Shift+R. "Deployed" and "what the club sees"
are not the same moment.

**The build is gated on `npm test`.** Typecheck runs but does not block — there is
a standing baseline of 46 pre-existing errors recorded in `CLAUDE.md`, so failing
on them would block every deploy forever. Watch the number instead: well above 46
means somebody added errors.

**If a deploy fails, look at which step failed before assuming the code is bad.**
The first run failed on the last step only — `Input required and not supplied:
firebaseServiceAccount` — because the secret above did not exist yet. Tests,
typecheck and build had all passed. A missing secret and a broken build look
identical in the red ✗ on the Actions list; they are not the same problem and
only one of them is yours.

**Re-running a failed deploy does not need a new commit.** Actions tab → *Deploy
hosting* → *Run workflow* → pick `main`. That is what `workflow_dispatch` on the
workflow is for: the usual reason a deploy fails is something outside the code
that has since been fixed, and re-deploying the same commit should not require
inventing a change to it.

### The deploy needs TWO things, and only one of them is the key

A valid service-account key is not enough. The account it belongs to also needs
permission to publish, and those are configured in different consoles — which is
why this looked like a key problem for five failed runs.

1. **A real key in `FIREBASE_SERVICE_ACCOUNT`.** Firebase Console → Project
   Settings → Service Accounts → Generate new private key. Paste the whole file.
   The preflight step checks this and names what is wrong.
2. **IAM roles on that service account**, in the *Google Cloud* console, not the
   Firebase one: `console.cloud.google.com/iam-admin/iam?project=magic-nutrition-club`
   → Grant access → the `firebase-adminsdk-fbsvc@…` account → **Firebase Hosting
   Admin** and **Firebase Viewer**.

Without step 2 the key authenticates perfectly and then every call returns
`403 The caller does not have permission`. `firebase projects:list` returns 200
with an *empty list* rather than an error, and the CLI reports "Failed to get
Firebase project … make sure the project exists", which points at the project and
the key — the two things that are fine. Step 2 has now been done once; it is
permanent, and it does not need repeating unless somebody makes a new service
account.

A key sent through a chat, an email or a screenshot is a key that must be
replaced: delete it under Service Accounts and generate a fresh one.

### Status as of 2026-09-03: step 1 has never been done

Checked against all nine runs. **Step 1 is still outstanding — the secret has
never contained a real key.** `FIREBASE_SERVICE_ACCOUNT` holds a placeholder
whose `private_key` is 56 characters over 4 lines: the BEGIN and END markers
with nothing between them. Every run since the preflight was added (#3 onward)
stops there, and the two before it (#1, #2) failed at the deploy step *before*
the IAM roles were granted.

Which means the note above overstates what is known: no run has ever reached
Firebase with a working key, so **the IAM grant in step 2 has never actually
been exercised**. It may well be correct. It has simply never been tested. If a
run gets past the preflight and then fails with `403 The caller does not have
permission`, step 2 is the place to look — that is the sequence, not a
contradiction.

Until step 1 is done, merging to `main` does **not** deploy. Nine merges have
now landed on `main` believing it did. Deploying meanwhile means a PC:

```bash
npm run build && npx firebase deploy --only hosting
```

The workflow now writes a plain-language panel to the run summary on every
failure, so this shows up on the phone as "the site was NOT deployed" instead
of only as a red tick somebody has to go and interpret. It also checks the live
site afterwards and fails if what is being served is not what the run built — a
green deploy step means the API accepted an upload, which is not the same thing
as the club having it.
