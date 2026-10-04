#!/usr/bin/env bash
#
# Deploys the nine background jobs from a phone.
#
# One paste, into Google Cloud Shell (console.cloud.google.com/cloudshell):
#
#   rm -rf ~/growline-deploy && git clone -q --depth 1 \
#     https://github.com/TheRealVDevelopers/GrowLine.git ~/growline-deploy \
#     && bash ~/growline-deploy/scripts/deploy-functions.sh
#
# ## Why this is the highest-value thing left
#
# The nine functions have never been deployed. The one that matters most is
# `onDailyLogWritten`: it maintains `users.thisMonthActivity`, which is *the number
# an upline sees on the team tree*. Until it ships, a mentor opens their team and
# watches nothing move — the daily accountability loop the whole product is built
# around (v1 §F6). The other eight are the retention purge, the voice-note purge,
# silence alerts, morning reminders, boards, qualifications and duplication.
#
# ## What it deliberately does NOT do
#
# **It does not run `backfill:prospect-activity`.** That is not an oversight, and
# the order matters more than it looks. The purge ignores any prospect with no
# `lastActivityAt`, so deploying without the backfill means it quietly does nothing
# — under-deletion, which is the safe failure. The backfill seeds the field from
# `createdAt`, and the script's own header spells out the consequence: a prospect
# captured 200 days ago but worked yesterday gets a value already past the window
# and their health data goes on the next run. So the backfill is what ARMS the
# purge, and it deserves its own deliberate session with `--check` first — not a
# line buried in a deploy script run from a phone at midnight.
#
# `--only functions`, always. `firebase deploy` with no `--only` ships everything
# it finds configured, including rules you may not have meant to touch.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

FB="npx -y firebase-tools@15"
PROJECT_ID="grow--line"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "1/4  Checking you are signed in"
if ! $FB projects:list >/dev/null 2>&1; then
  cat <<'MSG'

  Not signed in. Run this once, then run this script again:

      npx -y firebase-tools@15 login --no-localhost

MSG
  exit 1
fi
echo "  signed in."

say "2/4  Making sure CRON_SECRET exists in Secret Manager"
# Seven of the nine functions declare `secrets: ["CRON_SECRET"]`, and a secret
# reference that cannot resolve fails the WHOLE deploy — not just that function.
# So this has to be true before step 4, not after it.
if $FB functions:secrets:access CRON_SECRET --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "  CRON_SECRET already exists — leaving it alone."
else
  echo "  Not found. Generating one and storing it."
  # Generated here rather than typed: it is never read by a human, and a secret
  # somebody invents on a phone keyboard is a secret somebody can guess.
  #
  # `tr -d` matters. openssl ends its output with a newline, --data-file reads
  # stdin verbatim, and a secret with a trailing newline is one that compares equal
  # in some places and not others — the kind of mismatch that shows up months later
  # as a 503 nobody can reproduce.
  openssl rand -hex 32 | tr -d '\n' | $FB functions:secrets:set CRON_SECRET \
    --project "$PROJECT_ID" --data-file -
  echo "  CRON_SECRET created."
fi

say "3/4  Building the functions"
npm --prefix functions ci --silent
npm --prefix functions run build

say "4/4  Deploying"
$FB deploy -P prod --only functions --non-interactive

cat <<'MSG'

  Deployed. What works now, and what still does not:

    WORKS   onDailyLogWritten — team roll-ups start moving. This is the one that
            matters; an upline's team screen has never updated in production.
    WORKS   purgeStaleHealthData and the voice-note purge — both talk to Firestore
            directly. The health purge will find nothing until the backfill runs,
            which is correct and deliberate (see this script's header).

    NOT YET The seven that call the app's own HTTP routes. They will run on
            schedule and get a 503, because `checkCronSecret` refuses every
            request while the APP RUNTIME has no CRON_SECRET — and apphosting.yaml
            declares no secrets at all. That is one more change, and it could not
            be made before now: a `secret:` entry in apphosting.yaml that cannot
            resolve fails every rollout, so the secret had to exist first. It does
            now.

  Next: tell Claude "CRON_SECRET is created" and it will wire the app runtime.
  Watch the result in Cloud Logging, or on the screens that have been blank —
  leaderboards, qualifications, duplication.

MSG
