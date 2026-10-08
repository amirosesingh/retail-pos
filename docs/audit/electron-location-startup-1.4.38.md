# Location, settings, notifications and shift reliability — 1.4.38

## Confirmed faults and implemented changes

| Area | Confirmed problem | Code change |
| --- | --- | --- |
| Electron startup | An unavailable, unpaired or empty local replica blocked location discovery before cloud recovery. | `location-directory.ts` checks SQL readiness, reads populated local data first and falls back to verified cloud reads. The registered branch must exist; unrelated replicas cannot select a replacement branch. Startup displays the actual failure. |
| Empty setup | Global locks required a current location and setup routes could be unreachable. | Global setup reads work without a first branch; setup routes remain reachable. Paired terminals retain local-first operations. |
| Staff settings | Branch settings permission could authorize global edits. | UI, native SQL writes, relay and synchronization enforce branch ownership and admin locks. Cluster overrides and locks persist centrally. Global settings are admin-only. |
| Personal appearance | Theme/display writes affected shared settings. | Private, project-and-user scoped appearance covers theme, language/locale and display size. Staff Management includes `can_customize_display`; explicit denial is enforced by UI and server. Native preference storage is read first with central account persistence. |
| Notifications | Operational events required audit access; financial events and global configuration were too broadly accessible. | Branch operational and exact-target approval audiences are enforced; sales/shift financial events and notification configuration require admin access. Global rule updates merge atomically. |
| Warehouses | Transfer composition moved shelf stock before protected dispatch, allowing partial changes. | Composition no longer moves stock. Prepared database dispatch locks products, picks primary shelves before secondary/root and commits all items and logs together, rolling back shortages. Archived roots/parents and hierarchy cycles are rejected. |
| Shift opening | Duplicate clicks and swallowed RPC failures allowed unreliable opening. | Explicit opening permission, finite nonnegative float, local branch locking, cloud advisory locking and surfaced failures. Explicit staff permission denial is respected. |
| Shift closing | Renderer snapshots contained recent bills only, truncating long-shift summaries. | Local SQL and protected central SQL aggregate all stored bills. Local summary persists with cash count. New sales are blocked after closing begins; global WhatsApp delivery uses a bounded request and claim guard. |

The Staff Management permission matrix derives its display controls from the permission registry, so the new display permission appears alongside per-user branch settings and opening/closing permissions. Administrators retain global ownership. Personal notification settings were not introduced.

## Validation

The full regression suite passed: 226 files, 1,517 tests. Behavioral coverage includes location fallback and branch pairing, inherited branch overrides and locks, verified personal ownership, denied/stale settings callers, notification audiences, warehouse planning and full 10,000-bill shift totals. TypeScript, lint and platform renderer builds are checked before publishing this patch. The migration parses offline as PostgreSQL SQL and PL/pgSQL; live metadata was inspected read-only.

The selected beta project has an active location, RLS and authenticated staff-only location reads. The location fallback fix requires no location-table privilege relaxation.

## Deployment dependency and limits

`20261008133703_complete_settings_preferences_and_warehouse_dispatch.sql` is prepared but **not applied**. Automatic approval review rejected applying the persistent permissions and shift/warehouse migration without approval for this exact change. Do not release or merge the dependent application change before migration approval and successful deployment verification.

The release is not certified against installed Windows/Android devices, concurrent production SQL workloads or a 100,000-product production dataset. Tests of 10,000-bill aggregate inputs do not establish end-to-end performance at that scale. Personal language changes locale, formatting and document language; a complete translated UI catalog is outside this patch. Native system push delivery is not implemented by the existing push configuration flag. PIN-only terminals recover personal cloud preferences on focus/reconnection; instant cross-device preference delivery is not certified. Existing general-event and shift-summary WhatsApp rules are separate channels; administrators should avoid overlapping delivery rules.

This document describes the audited paths in this release, not an assertion that every page and external integration is free of defects.
