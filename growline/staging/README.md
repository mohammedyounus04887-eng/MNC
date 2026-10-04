# GrowLine isolated staging preparation

No deployment has been performed. The approved integration commit remains in history. Read PLAN.md for the deployment/actor/test/rollback plan. This repository still owns its own Firebase project; no direct Club database credential is required.

Copy targets.example.json to targets.local.json and server.env.example to server.env.local. Fill actual non-secret staging inputs; supply secret-manager bindings separately. The profiles currently have missing IDs and blank consent and default to INTEGRATION_HANDOFF_ENABLED=false and DEMO_MODE=false.

From the repo root:
- node --test staging/verify.test.mjs
- node staging/verify.mjs disabled

The preflight must exit 1 until inventory is supplied. It rejects existing project aliases, mismatched credential/browser/source/destination IDs, production endpoints, emulator/debug settings, shell overrides and optional payment/push/cron activation. It checks firebase.staging.json backendId and every non-secret apphosting.staging.yaml value against server.env.local, verifies variable availability and secret reference names, and rejects duplicate/unreviewed settings; it never resolves/prints a secret.

apphosting.staging.yaml deliberately overrides every existing production client/project/site variable, initially blank. Fill the non-secret entries from the reviewed staging inventory; set the independent staging backend Environment name to staging. NEXT_PUBLIC values require a fresh staging build. Keep NODE_ENV at the framework-managed production setting, not staging. Prefer the attached staging runtime service account through ADC. The GROWLINE_CLUB_SERVICE_KEY secret reference must exist and be granted only in the staging project before rollout.

Set firebase.staging.json apphosting[0].backendId to the confirmed staging backend ID. Use ONLY that config, an explicit actual GrowLine staging project ID and apphosting:<backend ID> after explicit staging approval. Its upload ignore list excludes local env files/credentials and the unrelated Functions package. Existing production deploy shell scripts are forbidden for this staging path.

The Next server/API and web deploy as one App Hosting artifact; there is no separate GrowLine Firebase Function in the core handoff. The staging config deploys no purge/scheduled jobs. No migration/backfill is needed or authorized.

Required core server secret: GROWLINE_CLUB_SERVICE_KEY. Optional FIREBASE_SERVICE_ACCOUNT is only an approved alternative to platform ADC. CRON_SECRET, VAPID_PRIVATE_KEY and payment secrets stay unset. SESSION_SECRET is obsolete for current Firebase sessions.

Before activation prove HTTP redemption returns/persists Club issuer UID (current Club response omits it), correct-link attribution, actual signed-in coach authorization, consent, no private/financial transfer and historical replay. Re-run the full GrowLine tsx unit suite on an environment that works; existing ENOMEM startup failures remain blocked.
