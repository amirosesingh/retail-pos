# PR 300 permission and CSP verification

## Implemented
- Preserve explicit page/action denials, strict boolean grants, and custom-role visibility overrides.
- Administrator-only global action/page restrictions. Global denials are materialized in the existing app_users permission matrix used by verified sessions and SQL synchronization.
- Preserve original grants privately for restoration; audit policy changes; retain administrator recovery access and branch assignments.
- Additional restrictive SELECT policies on business tables, combined with existing branch policies.
- Deny direct authenticated reads of PIN verifier columns. Electron business reads and snapshots enforce the corresponding permission matrix before returning records.
- Configure Zod's supported jitless interpreter; do not weaken the browser CSP with unsafe-eval.

## Verified locally
- Complete Vitest run: 405 files / 2,495 tests passed.
- 72 native startup, sync, database-upgrade and update-install tests passed.
- TypeScript and ESLint passed.
- Web, Windows, Android and iOS interface compilations passed. These are not signed installer builds.
- Isolated PostgreSQL-compatible PGlite tests: global denial precedence, supervisor denial, administrator exception, invalid keys, grant restoration, inactive accounts, branch RLS and PIN column denial.
- SQL install-order audit passed.

## Release gates / remaining review
- Shared POS migrations have NOT been applied. They affect production database access too and need explicit owner approval.
- Fine-grained cost/margin presentation toggles are not yet a complete backend data-redaction boundary. Product/sale cost fields also feed transaction accounting, so simply stripping them would damage costing. Finish trusted accounting/read projections and regression testing before claiming this part complete.
- Physical-device checks and signed-in non-admin end-to-end checks remain.
- No merge or publication has occurred. The owner now authorizes beta merge/publication after completion and passing checks; main remains unauthorized.

## Freshness
Connected clients receive the effective permission matrix through the existing account-change/session checks. Offline Windows uses its last verified synchronized matrix until connectivity returns. No new polling loop was added.
