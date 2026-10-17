# Isolated membership database

These migrations belong only to the dedicated Supabase membership project.
They are intentionally outside `supabase/migrations`, which is the POS
database migration stream.

Apply the files in timestamp order to the membership project. Never run this
directory against the POS project. POS lookup uses only the server-side
`MEMBERSHIP_SUPABASE_SERVICE_ROLE_KEY`; browsers and tills receive only the
membership project's publishable key.

The POS SQL database remains the durable operational store. It caches the
member UUID, phone membership number, name, tier and points, and each sale
references that UUID. Supabase Auth verifies the email OTP; email addresses,
OTPs, sessions and authentication data remain only in the membership project.
Phone SMS delivery is not required. There is no separate membership outbox
table.

## Signup policies and consent

`20261017120000_membership_signup_consents.sql` adds private, owner-readable
consent evidence and requires the current terms/privacy versions during public
enrollment. Apply it to the membership project together with the matching web
deployment: older signup clients do not submit consent and must refresh after
the change. The frontend checks the database's policy version and does not
silently enroll without consent support. This migration has not been applied
to a live database by this change. Do not run it on local SQL Server or in the
POS project's migration stream.

The readable policies are in `src/lib/membership-policies.ts`. These are general
drafts for the retailer to review against its actual identity, contact details,
reward rules, retention and service providers before public launch; they are
not a guarantee of legal compliance. Keep historical published wording in Git
and increment both the relevant version and its database check when changing
it. Required acceptance is separate from optional email/SMS marketing consent;
both controls start unchecked. Enrollment records the verified member/owner,
server acceptance time, policy versions and the exact marketing choice. This
does not enable marketing delivery or SMS authentication. Existing staff,
branch, rewards and POS membership synchronization remain unchanged.
