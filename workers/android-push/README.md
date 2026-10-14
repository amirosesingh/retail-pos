# Central Android push service

One vendor-owned Firebase project and Cloudflare Worker serve all enrolled companies.
Each company retains its own POS backend and database. The central service receives
only device delivery tokens, opaque staff/event IDs and current authorization results.
No sales values, customer names, passwords or Supabase keys are sent to Firebase.

## Provisioning

1. Create a vendor Firebase project and register Android package `com.luckycharms.pos`.
   Download its Android `google-services.json`. No Analytics integration is needed.
2. Enable the Firebase Cloud Messaging API and create a server identity with the
   Firebase Cloud Messaging API Admin role. Install the credentials as Worker
   secrets, never as APK/web environment variables:
   `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`.
3. Authenticate Wrangler. Create a D1 database named `retail-pos-android-push`,
   replace `database_id` in this directory's `wrangler.jsonc`, and execute
   `schema.sql` against that database.
4. Install the Worker secret `PUSH_TENANTS_JSON`. Each company gets a distinct,
   cryptographically random secret of at least 32 characters and its own HTTPS
   authorization callback. Example structure (placeholders only):

   ```json
   {
     "company-a": {
       "secret": "REPLACE_WITH_UNIQUE_RANDOM_COMPANY_SECRET",
       "callback": "https://company-a.example/api/v1/pos/push-service"
     }
   }
   ```

5. Deploy this Worker with its separate Wrangler configuration. Do not deploy it
   using the main POS Worker's configuration.
6. On **each company's POS server**, install `POS_PUSH_SERVICE_URL` (Worker HTTPS
   URL), `POS_PUSH_TENANT_ID`, and `POS_PUSH_TENANT_SECRET`. These are server-only
   values. A company's secret is never installed on phones or other companies.
7. For Android CI, install the vendor client configuration as repository secret
   `ANDROID_GOOGLE_SERVICES_JSON`. The APK workflow sets
   `VITE_ANDROID_PUSH_ENABLED=true` only when that configuration is present.
   For a local build, set `POS_ANDROID_FIREBASE_CONFIG` to the downloaded file
   and `VITE_ANDROID_PUSH_ENABLED=true`; run `npm run mobile:sync`. The setup
   script verifies the Android package name and copies the client configuration
   into the generated Android project. Default builds keep push disabled.
8. In Settings → Notifications & alerts, enable Android phone alerts and select
   event types, recipients, branches, and optional critical-only delivery.
   Selecting a recipient does not grant any new permission.

## Delivery and access

- Android asks the signed-in user for OS notification permission and registers a
  token through that company's authenticated POS server.
- Company server calls enqueue new events immediately. A one-minute central cron
  also scans each company's durable event feed to recover missed calls and events
  synchronized directly from Electron. Cursor paging uses timestamp **and ID**.
- The queue deduplicates company/event/device deliveries and leases work atomically.
  Each attempt checks the account's current permissions, activity audience, settings,
  active status and device ownership against the company's server. A verification
  outage postpones delivery rather than allowing it.
- Notifications have generic text and private lock-screen visibility. Tapping asks
  for the remembered user's password, then opens the existing permission-controlled
  notification report. The app lock retains the phone subscription; explicit logout,
  expiry or changing the account removes the native token and delivered alerts.
- Unregistered Firebase tokens are removed. Registrations expire after 30 days;
  signing in renews them. Eight failed attempts enter the queue's failed state.
  Finished/failed queue records are retained for 30 days.
- Web and Electron never enroll in OS push. Their current signed-in alerts remain.

## Operational checks

Run the push isolation tests and a Wrangler deployment dry run before deployment.
After installing credentials, verify delivery on a real Android device in the
foreground, background and locked state; test denied OS permission, explicit logout,
user/company switching, account deactivation, and a revoked notification permission.
Android force-stop and OS delivery restrictions can prevent delivery until the app
is reopened. No delivery has been verified merely by successfully building the APK.

Firebase private keys and company secrets must be rotated through secure secret
storage. Inspect D1 `deliveries` with `done=2` for exhausted retries; do not log or
export phone tokens. There is no unauthenticated registry or device-list endpoint.
