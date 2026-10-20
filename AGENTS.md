## Beta-first changes and production approval

- Start feature/fix branches from the current `beta` branch and open PRs into
  `beta`. Test changes there before proposing production promotion.
- Prefix beta PR titles with `[BETA]` and label them `beta`. Prefix PRs into
  `main` with `[PRODUCTION]`, label them `production`, and mark unapproved
  promotions `awaiting-owner-approval`.
- Promote tested changes with a separate `beta` → `main` PR. Never push,
  merge, or enable auto-merge into `main` without the owner's explicit approval
  for that specific promotion. Previous approvals and passing checks are not
  permission to promote new changes. Never assert approval on the owner's behalf.
- Keep Cloudflare beta websites live on beta pushes and keep checks automatic.
  Accumulate Android/Windows changes on beta; publish their paired beta installers
  only after the owner explicitly says “Publish beta now”. Do not create a
  `beta-publish-YYYYMMDD-HHMMSS` tag or dispatch the beta-release workflow without
  that request. Implementing or merging a fix is not publication approval.
- Preserve existing functionality, branch restrictions, permissions, and
  operator-managed database configuration. PR labels do not grant access or
  authorize production deployment.

## Supabase configuration (do not regress)

`supabaseConfig()` in `src/lib/external-supabase-config.ts` is the single
resolver for the Supabase URL and publishable key. On a till or phone the
values come only from Settings → Database & Cloud Connection, sealed in the
Electron OS vault (DPAPI) or the Android Keystore and applied through
`setTerminalSupabaseOverride()`. The web deployment supplies them through
hosting variables printed into the page.

Legacy generated clients (`client.ts`, `client.server.ts`,
`auth-middleware.ts`, and `auth-attacher.ts`) must not be reintroduced or
registered in `src/start.ts`. They bypass the runtime operator configuration
that device builds require. The guard lives in
`src/lib/__tests__/own-database.security.test.ts`.
