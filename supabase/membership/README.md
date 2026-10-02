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
