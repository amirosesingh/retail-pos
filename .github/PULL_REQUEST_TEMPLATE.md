## Destination

- Fixes/features: base `beta`, title `[BETA] …`, label `beta`.
- Tested production promotion: base `main`, head `beta`, title
  `[PRODUCTION] …`, labels `production` and `awaiting-owner-approval`.

## Change and validation

Describe the problem, resulting behavior, and relevant checks. Confirm that
permissions, branch restrictions, linked features and database configuration
continue to work.

## Production promotion only

- [ ] Tested in beta.
- [ ] The owner explicitly approved this specific promotion.

Record the owner's approval reference before merging. Green checks, labels and
previous approvals do not authorize merging into `main`. Do not enable auto-merge.
