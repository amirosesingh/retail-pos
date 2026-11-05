# Shift financial and sharing upgrade application — 5 November 2026

The owner approved the exact files below. Both cloud upgrades and the three local
metadata upgrades completed; root and independent read-only postflight passed.
No historical repair, queue/checkpoint reset, rollout activation, sharing-OFF
cutover, signing-key change or production publication was performed.

## Cloud target and exact artifacts

ROSEGILL POS: `rosegill0011@gmail.com's Org` (`bjxgimekljzlnwejuawj`), project
`pos` (`qhrufhtbeguxydenzfey`), database `postgres`,
https://qhrufhtbeguxydenzfey.supabase.co. The connector label is not an environment
boundary: this is the production database. Status remained `ACTIVE_HEALTHY`.

| Repository file | Approved SHA256 | Recorded live version |
| --- | --- | --- |
| `20261105090000_shift_financial_known_history.sql` | `A37FD005A688C1E2AC4815E0455E9B97B842531C3ACE0BC3F0A105287498EC2E` | `20261105020052` |
| `20261105090100_branch_shift_sharing.sql` | `17B9FB70FF19E5A43C034D9024D593C2918507257B7B92CD63E491AE9668FB07` | `20261105020324` |

The MCP assigns live migration versions. These rows correspond to the reviewed
repository files despite differing timestamps. Do not bulk-replay the files,
delete history or rewrite ledger versions. Any future CLI reconciliation needs
its own reviewed plan; source merge does not execute SQL.

The earlier `75DCFA47…F21F20` attempt was rejected by its exact-source guard and
fully rolled back. Verified then: zero new private schemas, protocol routines or
migration entries. The revised artifact accepts only two reviewed cosmetic
variants and handles CRLF before alias patching; unknown definitions and changed
authority remain rejected. A connector confirmation also expired without
execution; empty state was verified before the same approved request was reopened.

Successful postflight:

- Financial readiness true with 49 pinned contracts; sharing readiness true with
  24 contracts.
- All five original sale/refund/admin writers retain their reviewed normalized
  definitions, owners, execution modes and grants.
- Sharing defaults ON; its new boolean column is nullable with no default.
- The three new operating wrappers deny anonymous/authenticated execution and
  allow the service role. Private client write grants remain absent.
- Rollout approvals and protected-shift counts remain zero. No cohort is enabled.

## Local target and exact artifacts

Only `LAPTOP-N0QBONGL\LCRPOS` → `POS_Local`, database GUID
`CEAFA630-D613-423C-8997-8A31DF70C506`, was authorized and changed. Other PCs and
databases are excluded. Apply once per identified physical database GUID, not
once per terminal sharing the same storage.

| Prepared file | Approved SHA256 |
| --- | --- |
| `025_shift_financial_bases.sql` | `2C6E250D04855B86447603763C1A9304241D99D77814040756AB9AA67CB77897` |
| `026_shift_financial_operations.sql` | `26A55BC6FD352083AA388283F093212E9C74081E9C96FE87A79E71288AE235FA` |
| `027_shift_branch_sharing.sql` | `E0E9A77D847A08961BAA1EB7D75C67F971960E086FA286A7891FC424DE93F359` |

Exact canonical Git bytes were verified, including 027's LF encoding. Electron
was already closed and no other user session was connected. SQLCMD used the
reviewed identity/GUID/state guards, fail-fast error handling, a five-second lock
timeout and a thirty-second query timeout. Each file owned its transaction; no
cross-database or all-files atomicity is claimed.

Successful root and independent postflight:

- Ten financial metadata tables exist and are empty.
- Expected indexes, checks and ten triggers are present and enabled/trusted.
- Sharing is nullable `bit`, with no default and no non-null overrides.
- Registered migration level stays 24 by design: these prepared files do not add
  automatic installer receipts.
- All existing user-table row counts match the same-session preflight baseline.
  The scripts contain no business-row backfill, grant change or queue reset.

Do not rerun 026 or the complete installer. Preserve installed history and use a
separately reviewed forward correction if an unexpected later state is found.

## Security review and remaining gates

Security advisors reported expected [RLS-without-policy information](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
for the 26 private metadata tables: direct client access is intentionally denied.
The [authenticated SECURITY DEFINER notice](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
for `pos_shift_sharing_ready()` is intentional: it returns only a stable readiness
boolean, uses `pg_catalog`, exposes no business rows and denies anonymous access.
No broad policy/grant changes were made to silence advisors. Other project-wide
advisor notices remain outside this scoped application; no full security-audit
pass is claimed.

Remaining: final execution-documentation CI/beta integration, installed/deployed
acceptance, compatible-client and retained-work review before any separately
approved cohort activation, and specific production-promotion/publication approval.
Membership stays on hold. Booking-deposit attribution and held historical repair
359 remain separately tracked.
