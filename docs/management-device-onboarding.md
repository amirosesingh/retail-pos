# Staff verification and management devices

Reconciled **2026-10-27** against source `1af373f5` and the owner's current rules.
Read [project memory](PROJECT_MEMORY.md) and [task tracker](TASK_TRACKER.md).
This is documentation reconciliation, not a new device registration or a claim
that the AUTH/REP defects are fixed. Membership remains **ON HOLD**.

Staff accounts with a real email request a signup confirmation after the profile and role have been saved. A mail failure is reported separately; use Resend in Staff accounts instead of creating the account again. Email confirmation never changes the Enabled setting. Internal username/PIN accounts do not send mail. Delivery uses the existing Supabase email configuration and approved redirect configuration.

In Terminal Activation for Windows, or Settings → Mobile terminals for Android/iOS,
choose Operations or Management. Management registration uses the matching platform
and a NULL location in the existing terminal table, but NULL alone is not proof of
management authority. Registration grants no staff role or action permission.
Management sign-in uses the explicit computer/mobile admission grants, intentional
administrator behavior and legacy supervisor defaults in
`src/lib/management-device-access.ts`; admission never grants another branch.
An assigned account remains restricted; authorized management selection must follow
its actual allowed scope. Replica credentials are a separate download capability,
not staff business-write authority; see the replication runbook.

Existing branch mobile registrations and Operations Windows registrations remain
bound to their specific branch for every user, including administrators/managers.
There is no ordinary branch switch. All reads/writes, native/offline logic and
sync must enforce verified registration; see AUTH-01/02/04 for remaining gaps.

The earlier blanket "management PCs cannot synchronize local SQL" description is
superseded: configured management PCs have an authorized read-replica service.
Protected offline report code also exists, but its installed IPC wrapper currently
blocks it (REP-02). Do not call offline management reporting operational until
integration tests and device checks pass. Preserve saved SQL configuration;
legacy incomplete activations are not silently reclassified as management.

The owner explicitly includes existing Electron and mobile temporary registration,
pairing and activation, for both Operations and Management, in the next authority
review (AUTH-09). A normal session adoption is not branch reassignment. Reissue
requires a separate authorized/audited process and safe pending-work handling.

Separate admin-browser activation is retired. Its old URL redirects to Mobile terminals. Historical database activation/audit records are retained; no database rows are deleted. Normal browser authentication and active-session enforcement remain in use.

All branches is a display label for NULL staff branch assignment, not a literal
branch ID or a grant by itself. This documentation changes no assignments or
database. Nullable mobile locations already exist; a different replica feature
or future authority fix can have its own reviewed migration requirements.

## Live acceptance checks

- Create an enabled real-email test staff account, receive and confirm the email, then sign in. Disable the account and verify that email confirmation does not enable it.
- Create an internal username/PIN account and verify that no email is required.
- Register Android, iOS and Windows management devices using isolated fixtures.
  Verify explicit admission grants/denials, preserved defaults, assigned-account
  scope and authorized multi-branch selection; no role-based blanket rejection
  substitutes for the saved admission policy.
- Register a normal mobile branch device and a Windows terminal. Verify their fixed branch, existing billing and stock workflows, and rejection of a different branch write.
- Exercise repeated QR callbacks and Continue taps; retry after a network interruption.
- Open the retired admin-browser URL and verify the redirect, then check browser sign-in and remote session reset.

Automated tests and renderer builds do not replace these physical-device and email-provider checks. This change does not publish installers or promote to main.


## Home and Selling navigation

Terminal workspace settings and personal workspace selection are retired. Old settings links redirect to Settings. The data-only cleanup in `scripts/sql/retire-workspace-preferences.sql` removes only obsolete purpose/preference keys; selling layout, appearance, database configuration, branch restrictions and device registration are retained. Readers/writers strip the retired integration fields and personal appearance accepts old cached profiles without retaining the workspace preference.

After a new sign-in, administrators open Home when dashboard access is allowed; every other user opens Selling. An already restored session keeps its page. Home is the existing Live Dashboard and remains hidden without dashboard permission/page visibility. Selling always opens the Retail workspace, and Sell now opens the cart. Home provides permission-filtered Business Analytics, All Shops and Locations & Warehouses links. Audit History is in Reports. Restricted users who lack Home but have business-page permissions keep access through Business Overview.

Signed-in local preview checks cover Home, Reports and Settings, plus Selling/cart navigation. Automated restricted-user rendering tests cover Home visibility and selling/reporting permissions. Actual restricted-account sign-in and physical-device acceptance remain pending. No business transactions or permission changes are performed by these checks.
