# Retail POS

Cross-platform point of sale and shop management for sales, shifts, inventory,
membership, receipts, cash drawers, reporting, Windows terminals, and Android.

## Project instructions and current work

Before making changes, read [AGENTS.md](AGENTS.md),
[project memory](docs/PROJECT_MEMORY.md) and the
[task tracker](docs/TASK_TRACKER.md). They distinguish approved architecture,
current implementation gaps, unfinished work, verification and release approvals.
Normal Operations terminals are branch-locked for every role; management access
is separately scoped. Membership improvements are currently **ON HOLD**.

The [technical master](docs/POS-MASTER-DOCUMENTATION.md) and existing audit reports
remain references; their historical versions and completion labels are not proof
of a later build. Check the Git root, branch and commit before editing a worktree.

## Development

The sideloaded iPhone beta build and self-hosted OTA instructions are in
[docs/ios-ota.md](docs/ios-ota.md). Building an IPA does not publish an update.

Use Node.js 22 and npm 11.4.2.

```sh
npm install
npm run dev
```

Validation before release:

```sh
npx tsc --noEmit
npm test
npm run lint
npm run build
```

Supabase is resolved through the operator-configured runtime connection. Device
packages intentionally do not embed web deployment credentials.
