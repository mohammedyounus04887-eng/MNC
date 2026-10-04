# Club isolated staging preparation

No deployment has been performed. The approved integration commit remains in history. Read PLAN.md for the joint deployment order, actor assignment, 13-case acceptance matrix and rollback. This repo has no dependency on GrowLine source.

Copy targets.example.json to targets.local.json and fill the actual isolated staging project IDs/origins/backend inventory. Copy web.env.example to web.env.local and functions.env.example to functions.env.local, then copy web.env.local to ../.env.staging.local (from this directory). All project/client/UID/secret inputs remain missing; only safe flags/audience are configured.

From the repository root:
- node --test staging/verify.test.mjs
- node staging/verify.mjs disabled

The preflight must exit 1 until the actual non-secret values are supplied. It also refuses the current legacy client administrator bootstrap and production-configured messaging worker. Fix those release-path issues before approved staging deployment. No values are printed.

Use ONLY firebase.staging.json with an explicit actual Club staging project ID and a scoped --only argument after explicit staging approval. Its rules, Storage, Functions and Hosting predeploy hooks compare the CLI-selected GCLOUD_PROJECT against the reviewed manifest. Hosting always builds Vite mode staging; .env.staging.local must exactly match web.env.local. The installed functions/.env.<actual staging ID> must match functions.env.local and an unreviewed base functions/.env fallback is rejected. Install both profiles before preflight. Existing production/default CLI configuration is not used by this path.

Club server environment names: INTEGRATION_HANDOFF_ENABLED, CLUB_INTEGRATION_AUDIENCE, GROWLINE_PROJECT_ID. Secret Manager names: CLUB_GROWLINE_SERVICE_KEYS, CLUB_LINK_CODE_PEPPER. GCLOUD_PROJECT/GCP_PROJECT are managed by the platform. Keep INTEGRATION_HANDOFF_ENABLED=false during preparation and disabled verification.

After approval, install the non-secret Functions profile as functions/.env.<actual Club staging project ID>, never a production file. Stage secret material separately. Do not deploy unrelated scheduled Functions. The owner/admin callable is assignVerifiedClubAdministrator with clubId, actual uid, owner/admin role and real verificationReference; a separately bootstrapped, actual staging platform admin must make the call. Never use bundled bootstrap credentials or infer ownership from email/PIN.

Auth/Storage/Firestore and browser workflows must be checked in actual staging; offline preflight alone cannot prove live IAM, deployment approval, rule deployment or index readiness.
