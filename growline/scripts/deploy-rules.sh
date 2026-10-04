#!/usr/bin/env bash
#
# Deploys the Security Rules from a phone.
#
# One paste, into Google Cloud Shell (console.cloud.google.com/cloudshell), which
# works in a mobile browser and is already signed in as you:
#
#   rm -rf ~/growline-deploy && git clone -q --depth 1 \
#     https://github.com/TheRealVDevelopers/GrowLine.git ~/growline-deploy \
#     && bash ~/growline-deploy/scripts/deploy-rules.sh
#
# ## Why this exists
#
# Deploying rules needs a credential, and every way of getting one to a person
# holding only a phone is bad or blocked:
#
#   - `firebase login` on a laptop — there is no laptop.
#   - The GitHub Actions button (.github/workflows/deploy-rules.yml) — the right
#     answer, but it needs a FIREBASE_SERVICE_ACCOUNT secret that does not exist
#     yet, and the GitHub mobile app cannot dispatch a workflow at all.
#   - Pasting the whole of firestore.rules into the Firebase console by hand —
#     seven hundred lines, on a phone keyboard.
#
# Cloud Shell is the way through: a real terminal in a mobile browser, already
# authenticated as the project owner, with no key to create and nothing to store.
# The indexes were deployed this way once already.
#
# ## What it will and will not touch
#
# `--only firestore:rules,storage`, always. Never functions, never hosting, never
# indexes. `firebase deploy` with no `--only` ships everything it finds configured,
# which here would include nine Cloud Functions nobody asked to send.
#
# The rules going out are the rules 189 checks run against: CI runs all eight
# suites on every push, so a red master cannot reach this script.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

FB="npx -y firebase-tools@15"
PROJECT_ID="grow--line"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "1/3  Checking you are signed in"
if ! $FB projects:list >/dev/null 2>&1; then
  cat <<'MSG'

  Not signed in. Run this once, then run this script again:

      npx -y firebase-tools@15 login --no-localhost

  It prints a URL and asks for a code back — which is exactly the flow that
  works on a phone, because nothing has to redirect to localhost.

MSG
  exit 1
fi
echo "  signed in."

say "2/3  Deploying firestore:rules and storage to $PROJECT_ID"
$FB deploy -P prod --only firestore:rules,storage --non-interactive

say "3/3  Checking from outside that they are actually protecting it"
# Deliberately plain curl rather than `npm run verify:rules`: that needs `npm ci`,
# which on a mobile Cloud Shell session is several slow minutes for a check that
# is four HTTP requests. Same probes, same meaning — an anonymous client holding
# the public project id must be refused.
FAIL=0
for c in prospects users reports dailyLogs; do
  body=$(curl -s --max-time 20 \
    "https://firestore.googleapis.com/v1/projects/$PROJECT_ID/databases/(default)/documents/$c?pageSize=1")
  if printf '%s' "$body" | grep -q PERMISSION_DENIED; then
    echo "  PASS  $c refused to an anonymous client"
  else
    echo "  FAIL  $c did NOT refuse — rules are not protecting it:"
    printf '        %s\n' "$(printf '%s' "$body" | head -c 200)"
    FAIL=1
  fi
done

if [ "$FAIL" -ne 0 ]; then
  say "Something is readable that should not be. Do not leave it in this state."
  exit 1
fi

say "Done. Rules deployed and verified."
echo "For the fuller check, including whether these are OUR rules rather than the"
echo "default lock, run on a machine with the repo installed:  npm run verify:rules"
