# Soft-token approval fix

PR #321 keeps fixed approval PINs and Windows offline sign-in PINs unchanged.
On a registered native receiver, choose **Soft token** to identify the owner of
the current eight-digit phone code. The signed-in operator is not assumed to be
its owner. Ambiguous matches, replay, inactive credentials and insufficient
branch/action authority remain rejected.

## In-app notifications

Settings → Notifications & alerts → In-app notifications controls new events.
The existing `activity_events` inbox and `pos_settings.notification_settings`
storage are reused; there is no competing notification table or second inbox.
Delivery preferences do not change approval permissions or audit history.

Migration `20261023141539_soft_token_approval_notifications.sql` adds an
AFTER INSERT trigger on `authorization_log`. A successful `totp` approval
creates one recipient-scoped event naming its owner, requesting operator,
action and ticket reference. Failure and ordinary PIN records do not create
this event. This means “approval granted,” not “sale completed.”
An additional activity-insert trigger applies saved in-app preferences to
SQL-generated events too, keeping their history and other delivery channels.

Offline Windows approvals reach the owner's cloud inbox after their audit
record synchronizes. The recipient needs connectivity to receive that event;
this is an in-app notification, not a guaranteed background iOS push.

The migration does not modify existing rows or table permissions. It is
prepared for review, not applied automatically to the shared production/beta
database. No local SQL Server column migration is needed for this change.

## Device acceptance

1. Register eligible users on two phones, with soft tokens enabled and their
   authorized branch/action rules configured.
2. On Electron, request approval, select Soft token, and enter phone A's code.
   Confirm the displayed/audited approver is A even if the operator is B.
3. Repeat with B's fresh code; attempt reuse, an invalid code and an account
   without the required authority. Each rejected attempt must grant nothing.
4. Confirm only the intended owner can see the notification, and that switching
   off the event type suppresses new notifications but preserves approval logs.
5. Verify fixed PIN confirmation and ordinary login remain unchanged. Test
   local-SQL offline approval separately after verifier provisioning/sync.

Automated tests cover code identity, collision rejection, platform issuer/
receiver combinations, replay, preferences and the SQL trigger. They do not
replace testing the reported failure on the installed devices.
