# Beta releases

Merge development changes into `beta` to accumulate fixes. Pushes continue to
run regression checks and update the live Cloudflare beta websites. They do not
build or publish Android/Windows beta installers.

Only when the owner explicitly says **“Publish beta now”**, publish one combined
Android/Windows beta from the selected, checked beta commit. The beta workflow
builds both in parallel, validates that both belong to that same commit, and
publishes a GitHub prerelease and the isolated `/pos-app/beta/` feed. Both builds
must succeed before either update is advertised. Stable feeds and releases stay
unchanged. Cloudflare remains live on beta pushes; it does not wait for installer
publication.

To request the installer release after owner authorization:

1. Select the intended `beta` commit and wait for its regression checks to pass.
2. Create and push a lightweight tag `beta-publish-YYYYMMDD-HHMMSS` (UTC timestamp)
   pointing to that exact commit. Never create this tag without the owner's
   publication request. Unlike a default-branch dispatch, this works while the
   release workflow exists only on beta, without merging anything to main.
3. The workflow verifies beta ancestry and successful regression checks on the
   exact commit before building. An unconfirmed dispatch, ordinary beta push,
   stable release tag or malformed publication tag cannot publish beta apps.

Once GitHub exposes the workflow's manual Run button, dispatch it on `beta` with
`confirmation` exactly `Publish beta now` as an alternative. This is the same
owner-authorized release operation, not permission to publish automatically.
The confirmation input and reserved tags are operator controls, not a substitute
for GitHub repository access restrictions. Never dispatch both methods for one
release. Do not move/reuse publication tags or retry an old release over a newer
published beta. Leave corrections on beta until the owner requests the next
installer release.

After the installers and GitHub prerelease are published successfully, retention
keeps the latest six published beta versions. Older beta GitHub prereleases,
their beta tags, archived installers and versioned download aliases are removed.
Cleanup checks that all beta update pointers agree and protects the current
version. It only deletes recognized files under `pos-app/beta/`; stable releases,
active update pointers and newer incomplete uploads are never removed.

Android installs as `com.luckycharms.pos.beta` (Retail Beta). Windows uses
`app.lovable.pos.beta` (Retail Beta). They can be installed alongside stable and
have their own device configuration and registration. Configure their connection
through Settings → Database & Cloud Connection, as with stable devices.

Cloudflare's `retail-pos-beta-domains` Worker runs the complete beta web app,
with its own deployments and persisted invocation logs. It is connected to the
`beta` branch; `retail-pos` remains connected to `main`. Cloudflare calls the
active deployment of each Worker "Production"; this does not make the beta
Worker part of the production POS.

The dedicated beta Worker serves only
`beta-pos.luckycharmsdnbhd.com`, `beta-member.luckycharmsdnbhd.com`, and
`beta-redeem.luckycharmsdnbhd.com`. The earlier proxy under
`workers/beta-web-domains` is a rollback reference, not the current application
deployment. Do not redeploy that proxy over the application accidentally.

Build beta with `POS_RELEASE_CHANNEL=beta npm run build`, then run
`node scripts/prepare-cloudflare-beta.cjs` and deploy using
`npx wrangler deploy --config dist/server/wrangler.beta.json --keep-vars`.
The helper preserves Nitro's assets and module paths, selects only the beta
domains, enables logs and leaves database configuration in Cloudflare.
Until the helper is merged into beta, the beta Worker's saved deploy command
performs the same configuration conversion inline. Never run the default
production deploy command for a beta publication.

The beta Worker has its own encrypted runtime secrets. Keep service credentials
out of build variables, browser assets, Git and local plaintext files. Its
settings encryption key must be compatible with the existing signed sessions,
terminal accounts and encrypted records; it is distinct from a Supabase API
key unless explicitly configured to the same value. Do not rotate production
keys as part of separating the beta website.

The main Worker's build and Version commands skip `beta`, avoiding duplicate
beta uploads under its production history. Other feature branches can still
create immutable PR version previews without changing the shared beta domains.
Production builds/deploys wait for the final
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
