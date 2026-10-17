# Native approval credentials

Android and Electron keep the existing approval request and authorization PIN paths. An enabled eight-digit soft token can also be entered in the same approval field. This is an approval credential, not a sign-in PIN or a replacement for user permissions.

## Set up after updating

1. On a registered Windows till, a user with staff-management permission signs in online once. The app automatically creates a verifier key in the Windows OS vault and registers only its public key with the backend. Cashiers cannot enroll or replace a verifier key.
2. Open Staff → the eligible user's approval credentials on a native app. Enable Authorization PIN, Soft token (TOTP), or both. The existing action rules still decide who may approve and how much. Copying page permissions does not copy these switches.
3. The enabled approver signs in online on a registered Android device. Their own token enrollment is stored in Android Keystore, bound to that user session, device and database project. The Approval token button appears in the app header and on the offline connectivity screen.
4. The Windows till refreshes its encrypted, branch-scoped verifier bundle in the background. Allow up to one minute after a new phone enrollment.

The phone can then generate codes without internet. It does not gain offline billing or offline database access. Enter the approver's staff ID and either their authorization PIN or token in the existing approval dialog. Local token verification requires the branch's existing offline rules to permit the action. Online-only restrictions, authority limits and the approval audit remain in force.

## Offline limits

Phone enrollment and the Windows verifier bundle renew online and remain usable offline for 24 hours. A disconnected device cannot immediately discover a central account/terminal revocation; reconnecting renews or removes its enrollment. The local SQL account flags and approval rules are still checked for each offline approval. Logout, idle lock, switching user, changing terminal or changing database project invalidates the phone's session-bound token view. Device clocks must be accurate; the verifier accepts only the current or adjacent 30-second step. Reuse is rejected durably by each verifier; disconnected tills cannot coordinate a global single-use decision until they reconnect.

## Isolation and deployment

Native token interfaces, credential controls and Keystore enrollment are resolved at build time. Website builds use empty platform implementations; `scripts/verify-approval-build.cjs` checks the actual client artifacts. The hosted backend retains the protected native enrollment/verification APIs. A bare terminal token can retrieve only an encrypted verifier envelope; its private key stays in the Windows OS vault.

Supabase migration `20261017121938_private_approval_tokens.sql` creates private, RLS-enabled token/key records and a service-role-only routine. Credential secrets are encrypted using a domain-separated key derived from the existing `SETTINGS_ENCRYPTION_KEY`. No business rows or branch policies are rewritten. Page-permission updates preserve credential switches atomically. Native data remains in the existing SQL Server tables; no manual local SQL upgrade is required for this feature.
