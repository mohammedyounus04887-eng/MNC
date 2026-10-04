# Magic Nutrition Hub

Club management app — reception, kitchen, member app, admin, super admin.
Vite + React + TypeScript + Firebase (Firestore, Auth, Hosting).
Live at https://magic-nutrition-club.web.app (super admin) and the club domain.

## Read this first

**[REBUILD_NOTES.md](./REBUILD_NOTES.md)** — the current state of the rebuild,
the decisions already locked, the shared writers to use, and the landmines.
Read it before proposing or changing anything.

## Working from two devices

**[HANDOFF.md](./HANDOFF.md)** — this repo is worked on from a phone (cloud
sessions) and a PC, with GitHub as the only pipe between them. Pull before you
touch anything; **push after every change, however small** — after each discrete
change, never batched into one commit at the end of a session. An hour of unpushed
work is an hour a reclaimed container can delete, and a fat commit is unreviewable
from a phone.

## The one rule

> Any number of doors, exactly one pipe.

Several screens may start an action. **Exactly one piece of code may write it.**
This app's problems came from the same job being done five different ways, with
the copies drifting apart. Before writing a new writer, check `src/lib/` for the
existing one.

## Checks

```bash
npm run typecheck   # tsc -p tsconfig.app.json --noEmit — baseline is 46 errors
npm run build
npm run test
```

**Never use bare `tsc --noEmit`** — the root tsconfig has `files: []`, so it
checks nothing and reports success. `vite build` does not typecheck either.
If your error count is above **46**, you introduced them.

## Deploying

```bash
npm run build && npx firebase deploy --only hosting
```

- New screens ship **behind the version switch, off by default**
  (`/admin/app-version`). Nothing should ever be one-way.
- The app is a PWA and caches itself — after deploying, hard refresh
  (Ctrl+Shift+R) or the device keeps running the old code.
- **Do not deploy Firestore rules or Cloud Functions without the owner present.**
  Everything writes as an anonymous user; one rule too strict stops the club
  mid-service.

## Conventions

- Dates for a club day: `todayLocal()` from `src/lib/clubDay.ts`.
  Never `toISOString().slice(0,10)` — IST is UTC+5:30 and it misfiles anything
  before 05:30 under the previous day.
- Money always through `src/lib/recordPayment.ts`.
- Attendance always through `src/lib/attendance.ts`.
- Colours and type from `src/styles/theme.ts` (hand-styled screens) or the
  `.dark` block in `src/index.css` (Tailwind screens). Same palette, two
  syntaxes — do not add a third.
