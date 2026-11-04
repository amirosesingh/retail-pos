# READ57: connection and duplicate-read audit

4 November 2026. Owner approved preparation and isolated tests only.
No pool, scheduling, authentication, runtime or business-data changes are made.

## Observed snapshot and code

At 15:32 Brunei, PostgreSQL reported 24 client connections (1 active, 23 idle),
including 14 PostgREST connections, plus one replication connection and two
background workers. These are 27 processes, not 27 terminals or concurrent
downloads. The inspection request itself contributes an active connection.
The local Electron process had two SQL sessions. Counts fluctuate.

Core synchronization already has one exclusive lane per Electron process:
upload first, then download. Telemetry, authorization refresh and health checks
have separate responsibilities. Native renderer telemetry does not duplicate
the native telemetry worker. Pool capacity is not the number of active queries.

## Reproduced duplicate work and correctness limit

Run `node scripts/diagnose-read57-reconciliation.cjs --run` from the repository.
The harness executes the actual lifecycle reader using synthetic promises only,
with no database, network, credentials or operator profile access.

It reproduces two simultaneous identical comparisons issuing two local count
queries and two cloud count requests. It also reproduces an old comparison
publishing after its pool/profile has changed. It labels both as known risks,
not corrected behavior or passing production acceptance.

There is no complete current mutation generation covering local SQL, external
writes and remote changes. Therefore completed startup results must not simply
replace later fresh comparisons. A scheduling timestamp is not freshness proof.
Serialization alone reduces overlap but does not eliminate query count.

## Reviewable next design, not implementation

Any in-flight sharing needs a defined advisory-snapshot contract, identity keyed
by actual pool/profile/backend/terminal/branch/history context, post-await scope
validation and a monotonic publication fence. Manual verification, post-write,
repair and closing checks must retain their fresh-read requirements. Equal counts
must not acknowledge uploads, clear pending work or establish deep verification.

Test simultaneous calls, failures, pool/profile/branch/terminal/backend changes,
old-after-new completion and fresh manual/post-write requests before application.
Do not claim a fixed reduction from 24 connections to another number. Measure
duplicate query/request savings separately from shared idle connection counts.

The safe fetch-failure diagnostics are a separate batch (NET56/PR386). They do
not themselves fix the intermittent network cause. Membership remains on hold.
