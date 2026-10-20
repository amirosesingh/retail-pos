# Staff verification and management devices

Staff accounts with a real email request a signup confirmation after the profile and role have been saved. A mail failure is reported separately; use Resend in Staff accounts instead of creating the account again. Email confirmation never changes the Enabled setting. Internal username/PIN accounts do not send mail. Delivery uses the existing Supabase email configuration and approved redirect configuration.

In Terminal Activation for Windows, or Settings → Mobile terminals for Android/iOS, choose Operations or Management. Management registration is for Windows/Android/iOS administrators and supervisors, without a fixed branch. It uses the matching platform and a NULL location in the existing terminal table. Registration grants no role or permission. The current enabled staff account is checked by the hosted relay. An assigned account stays on its branch; an All branches manager can choose branches. No machine credentials are provisioned for a management device.

Existing branch mobile registrations remain branch-bound. Operations Windows registrations still require a branch and use the configured terminal workspace. Management PCs use online business data; local SQL access and synchronization are blocked without erasing saved local database settings. Legacy incomplete activations are not silently reclassified as management. Web and mobile workspace choices follow the signed-in user; destination permissions continue to apply.

Separate admin-browser activation is retired. Its old URL redirects to Mobile terminals. Historical database activation/audit records are retained; no database rows are deleted. Normal browser authentication and active-session enforcement remain in use.

All branches is a display label for NULL staff branch assignment, not a literal branch ID. No existing account assignments are rewritten. The POS database already supports the required nullable mobile location; no migration or local SQL update is needed.

## Live acceptance checks

- Create an enabled real-email test staff account, receive and confirm the email, then sign in. Disable the account and verify that email confirmation does not enable it.
- Create an internal username/PIN account and verify that no email is required.
- Register Android, iOS and Windows management devices. Verify admin/supervisor sign-in, cashier rejection, an assigned supervisor's branch restriction and All branches selection.
- Register a normal mobile branch device and a Windows terminal. Verify their fixed branch, current purpose, existing billing and stock workflows, and rejection of a different branch write.
- Exercise repeated QR callbacks and Continue taps; retry after a network interruption.
- Open the retired admin-browser URL and verify the redirect, then check browser sign-in and remote session reset.

Automated tests and renderer builds do not replace these physical-device and email-provider checks. This change does not publish installers or promote to main.
