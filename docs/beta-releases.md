# Beta releases

Push approved development changes to `beta`. The beta workflow builds Windows
and Android in parallel, validates that both artifacts belong to the same commit,
and publishes a GitHub prerelease and the isolated `/pos-app/beta/` update feed.
Both builds must succeed before either update is advertised. Stable feeds and
the stable GitHub release remain unchanged.

Android installs as `com.luckycharms.pos.beta` (Retail Beta). Windows uses
`app.lovable.pos.beta` (Retail Beta). They can be installed alongside stable and
have their own device configuration and registration. Configure their connection
through Settings → Database & Cloud Connection, as with stable devices.

Cloudflare's connected beta branch uses a Worker version preview, with a Beta
badge and beta update feed. Production routes stay assigned to the production
deployment. Preview URLs are enabled in `wrangler.jsonc`.

The dedicated `retail-pos-beta-domains` routing Worker serves only
`beta-pos.luckycharmsdnbhd.com`, `beta-member.luckycharmsdnbhd.com`, and
`beta-redeem.luckycharmsdnbhd.com`, forwarding to the fixed beta version alias.
It has no database credentials. Beta public links use those domains without
editing the production domains in shared settings. External request origins
remain external so upstream CSRF checks still apply.

Cloudflare's non-production Version command must use `wrangler versions upload`,
never `wrangler deploy`. Production builds/deploys wait for the final
`chore: release vX.Y.Z [release]` commit. An earlier merge build is skipped;
the final version commit builds and deploys once. The release workflow creates
that marker even when versioned files were already prepared in the PR.

For now beta uses the existing production database and access rules. Beta sales
and other writes are real business data. This setup does not create a test
database or apply migrations.

Every fix/feature starts on a branch based on `beta`, with a `[BETA]` PR targeting
`beta` and the `beta` label. Internal PRs are automatically labeled and prefixed
by their destination; fork PRs require manual labels because their tokens are
read-only. Both beta and production PRs appear in GitHub's same PR list. A merged
beta PR moves to the Closed/Merged list; it does not become a production PR.
Dependabot maintenance PRs are configured to target and label `beta`; their
restricted tokens do not run the metadata writer. GitHub-generated security PRs
that target the default branch still require beta testing and owner approval
before production promotion. Default-branch configuration changes take effect
when the owner approves their promotion to `main`.

Promotion is manual: after beta testing, open a separate `[PRODUCTION]` PR from
`beta` to `main`, labeled `production` and `awaiting-owner-approval`. Merge only
after the owner explicitly approves that specific promotion. Passing checks and
labels do not constitute approval. New commits invalidate prior approval; the
label workflow marks updated production PRs as awaiting approval again. Never
enable auto-merge into `main`.

These are workflow instructions and status labels, not a GitHub branch-protection
rule. Only merging to `main` runs the existing stable version/release flow.
Beta publication does not merge, promote, or create a stable version.
