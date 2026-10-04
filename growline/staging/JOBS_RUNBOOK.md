# GrowLine existing background jobs — staging runbook

All nine existing background Functions remain disabled by `GROWLINE_JOBS_ENABLED=false`. Staging core deployment intentionally omits these Functions. Deployment and activation require a separate approved staging step; no production schedule or purge was activated.

| Existing Function | Current configuration | Work |
|---|---|---|
| onDailyLogWritten | dailyLogs write trigger | Transactionally recompute current India-month activity; retries do not increment twice |
| morningReminder | every 60 minutes, UTC | Authenticated `/api/notifications/daily`; route applies each coach's reminder preference |
| purgeStaleHealthData | 03:00 daily, Asia/Kolkata | 180-day inactivity health/report retention |
| rebuildLeaderboards | every 3 hours, Asia/Kolkata | Workspace-partitioned boards |
| evaluateQualifications | every 3 hours, Asia/Kolkata | Current scoped qualification audience/progress |
| qualificationReminders | 09:00 daily, Asia/Kolkata | Eligible scoped milestone reminders |
| rebuildDuplicationScores | 04:00 daily, Asia/Kolkata | Current workspace/tree duplication scores |
| silenceCheck | 09:00 daily, Asia/Kolkata | Current scoped silence alerts |
| purgeVoiceNotes | 03:30 daily, Asia/Kolkata | Scoped 30-day voice-note cleanup |

## Transport, scope and retries

Scheduled HTTP wrappers require their own feature flag, reviewed HTTPS `SITE_URL` and `CRON_SECRET` (minimum 32 characters) shared with the Next server. Redirects are rejected; requests time out after 120 seconds. Schedules use one instance and up to three retries. Loopback HTTP is accepted only for an explicit emulator runtime. Logs contain job/result metadata, not prospect health data or credentials.

Queries and writes verify current workspace, enabled coach and live team ancestry. Legacy records without a usable workspace are excluded rather than relabeled. Cached qualification readers re-check current coach membership so a moved/disabled coach cannot remain visible until the next rebuild. Broad job queries reject results above 10,000 records instead of silently truncating; assess staging volume and provision a reviewed pagination design before larger deployments. Owner activity is independently bounded to 25 coaches and 31 days per page.

Notification milestone claims are written before delivery attempts. This prevents repeated automatic attempts but does not prove provider delivery. An interrupted/unknown delivery requires operator review before resetting a claim; never describe it as exactly-once delivery. Roll-ups and derived caches recompute deterministically rather than incrementing on every event.

## Health retention

The 180-day threshold uses current inactivity. A transaction re-checks latest activity, coach ownership and workspace before modifying a candidate. Height, weight, age and gender are nulled and scoped wellness reports removed; contacts, private notes, acquisition metadata and unrelated Club data are preserved. Legacy/foreign/disabled-scope records are skipped.

Each run considers at most 50 candidates; each transaction handles at most 200 reports. A checkpoint and cycling partial candidates allow a large candidate to finish on later runs. Emulator tests cover exact cutoff, recent activity, changed ownership, partial report batches, dry-run and repeated execution. `purgeHealthRetention(db, now, { dryRun: true })` returns counts without writes or checkpoint changes. No destructive production execution is authorized.

## Voice retention

At most 400 candidates are considered. A transaction checks age (30 days), status, unchanged candidate and current owner/workspace. Counted, replaced, recent and ambiguous legacy records remain intact. Dry-run is available through the purge function and authenticated `/api/voice-logs/purge?dryRun=1`; it does not authorize activation or production deletion. Confirmed voice-log business flow remains separate.

## Before approved staging activation

1. Verify isolated project, runtime service account, Next origin, secret binding, rules/index readiness and sanitized fixtures.
2. Review retention policy, backups, expected volumes and skip counts with the responsible owner. Run dry-runs first.
3. Review reminder timezone/provider configuration and unknown-delivery handling. Payment credentials remain unset.
4. Deploy only the reviewed named background Functions and the corresponding API configuration. Keep flags false until smoke/dry-run evidence is recorded.
5. Enable both Functions and API job flags only in the approved staging environment. Exercise schedule retries, current-workspace changes and retention checkpoints.
6. Roll back by disabling API and Functions job flags and schedules; retain checkpoints/audits/claims for review. A genuine purge cannot be reversed by inventing deleted health data.

Legacy workspace backfills, production schedules, real push delivery and production retention are outside this local run and require separate review/approval.
