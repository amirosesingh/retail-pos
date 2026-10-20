# Self-hosted iPhone beta OTA

## Scope and prerequisites

This is the sideloaded iOS beta app, not an App Store release. It shares the React POS and online-only business data flow with Android. Android retains signed APK updates; Windows retains Electron installers; web contains no iOS OTA code. No SQL schema or auth/branch permission changes are made.

Dependencies are pinned: Capacitor iOS 8.5.2, updater 8.53.0 (Capacitor 8), noble Ed25519 3.2.0, CLI 7.87.0. CLI 8.89.0 was inspected but adds a node-forge high-severity advisory; 7.87.0 provides the verified `bundle zip --path --bundle --name --json` interface with zero npm audit findings. Recheck dependencies before later releases. Keep the updater's MPL licence and third-party notices.

A Mac/Xcode and CocoaPods are required to compile. The existing ML Kit scanner lacks Swift Package Manager support, so this project uses CocoaPods. `npm run ios:sync` on Windows generates/copies configuration but cannot install pods or invoke Xcode. The macOS workflow compiles a device .app and wraps it into an **unsigned IPA**. Sideloadly signs/installs it; it does not compile Swift. Free Apple Personal Team profiles expire after seven days; OTA does not renew provisioning. Confirm the Apple account's distribution permissions for the intended devices. No executable/native code is downloaded by OTA; a new native plugin, entitlement, permission, Swift change or incompatible native API requires a new IPA.

## Build and test without publishing

The minimum deployment target is iOS 26, supporting the recent iOS 26 and 27 releases; see the [plugin's iOS requirements](https://capawesome.io/docs/sdks/capacitor/mlkit/barcode-scanning/). An iOS build rejects POS_MOBILE_URL so a remote website cannot replace the bundled, verified interface. Android configuration remains unchanged.

Use the repository Node 22 and npm 11.4.2 toolchain, then `npm ci`.

- `npm run ios:build`: package the offline React interface in capacitor-shell using iOS-only adapters.
- `npm run ios:sync`: build plus official `cap sync ios`.
- Push a beta PR: `.github/workflows/ios-beta-build.yml` builds the unsigned IPA on macOS in parallel with existing Android and Windows PR checks. Download the `Retail-iOS-Beta-unsigned-<commit>` Actions artifact.
- A future explicitly authorized beta installer release also starts the iOS artifact build. Existing Android/Windows publication gates are preserved; the iOS artifact is not uploaded to their update feeds.
- Native beta identity: com.luckycharms.pos.beta, native build 3, marketing version 1.4.74. Increment the native build when native APIs change and explicitly choose matching manifest minBuild/maxBuild. OTA versions are separate semantic versions.

Do not publish merely because a build passes. This task authorizes a PR and IPA build, not deployment or a release.

## Trust and signing

`ios-ota.public.json` is embedded in the signed IPA's Capacitor configuration. The iOS-only RetailOtaTrust bridge reads that native configuration and native CFBundleVersion. OTA metadata cannot supply a replacement verification key, hostname, channel or app ID. Keep the app ID aligned if using Sideloadly signing options; never install a production configuration into the beta app.

`npm run ota:ios:keygen` creates an Ed25519 key in ignored `.ota-private/manifest-ed25519.pem` and writes only its public key into the public config. The command refuses to overwrite an existing key. Back up that private key securely offline and restrict its filesystem ACL. Never add it to Git, a VITE variable, Cloudflare, or the app. Replacing the public trust key requires a new IPA. Do not casually regenerate the initial key.

Manifests are an envelope `{payload, signature}` where payload is base64 of exact UTF-8 JSON bytes and signature is base64 Ed25519 signature of those bytes. Strict schema validation happens after signature verification. The payload includes version, appId, platform, channel, exact immutable ZIP URL, SHA-256, byte size, notes, minBuild/maxBuild, issuance/expiry and rollout percent/salt/stopped. Maximum response size is enforced while streaming (32 KiB); expiry is enforced using device time. Incorrect device time can reject an update. Both fetch and URL validation fail closed; manifest redirects are forbidden. Serve immutable ZIP paths directly without redirects. The native downloader verifies SHA-256 and the app checks its returned checksum before activation.

## Prepare and publish

The packaging command always rebuilds the iOS interface before zipping it. This prevents a previous Android build in the shared capacitor-shell folder from becoming an iOS OTA release.

Copy `.env.ios-ota.example` to a private local environment file. These variables are for Node release scripts, not React. Set explicit native build limits, release notes and rollout. Default rollout is 0%, not everyone.

1. `npm run ios:build` using the exact reviewed source.
2. Set OTA_VERSION or let the script generate a timestamp prerelease. Never reuse a release version.
3. `node --env-file=<private-env-file> scripts/ios-ota.cjs package` uses the official Capgo ZIP format, confirms the embedded signing key, hashes the ZIP and signs metadata. Files stay in ignored ota-artifacts/<version>. index.html and all client assets are at the expected bundle root.
4. Inspect the ZIP and manifest, run tests and complete physical iPhone staging tests.
5. Only after owner approval, provision the separate Cloudflare route from `server/ios-ota/wrangler.example.jsonc`. It binds the existing update bucket, initially stops checks, and touches ONLY `/pos-app/ios-ota/*`. Do not replace existing APK/EXE workers or routes. No Supabase credentials are needed. This example has NOT been deployed.
6. Set OTA_PUBLISH_CONFIRM to `Publish iOS OTA now`, provide bucket-scoped AWS/R2 credentials, then `npm run ota:ios:publish -- <version>`. The script refuses reused/older versions, uploads the ZIP, reads it back and verifies the checksum before changing the stable channel manifest.
7. Confirm HTTPS status, checksum, no-store manifest caching and immutable ZIP caching; enable the route only when ready.

For production use a separately reviewed native trust configuration and production channel endpoint. Do not silently switch existing staging devices. Roll out to 0%, then a small cohort, then wider after real-device tests. Cohort selection is deterministic from a random local installation ID and signed salt. To increase a rollout, publish a newly signed higher version under this initial strict immutability policy. Set Worker OTA_STOP=true for immediate online stop; checks/download/install revalidate before activation. An offline already-running bundle cannot be remotely revoked. Never overwrite an immutable ZIP.

## Lifecycle, safe installation, data and recovery

The iOS boot boundary calls notifyAppReady before any network or authenticated application initialization. The 15-second native readiness watchdog is independent of database connectivity. Calls are deduplicated per WebView launch. Launch, foreground and online events check the self-hosted endpoint, with a 60-second debounce; manual checks bypass debounce, not the concurrent-operation lock.

Automatic download/install are off initially. Download progress is plugin-reported, not simulated. Transient download failures get at most 3 attempts with backoff; ZIP/checksum/storage errors do not retry automatically. Downloads are not treated as ready until verification completes.

Automatic activation is conservative: only the visible, read-only Software updates route with no open dialogs, busy controls or form edits in the launch is eligible. Otherwise the update stays ready. Manual Install asks the operator to save/finish all work. The existing ticket-draft flush runs before native activation and its failure prevents reload. Authentication, secure connection settings and the database are not cleared or migrated. Only updater metadata and a safe route marker are stored in Preferences; no business offline database is introduced. `set({id})` is the final successful operation; there is no additional reload.

Failed-version and pending-activation records survive restarts. Native rollback events mark releases failed and prevent repeated automatic attempts. Previous bundles are retained (`autoDeletePrevious=false`); explicit recovery can activate the recorded previous bundle or reset to the built-in IPA interface. The highest successful version remains recorded even after explicit recovery, so an old server manifest cannot silently downgrade the app. Recovery never clears persisted business/configuration data. Future persisted-schema changes MUST remain readable by the previous and built-in bundle, or require a new IPA.

Readiness proves JS initialization only, not later sales/API correctness. Optional application-error monitoring shows a recovery notice; it never automatically reloads an active sale. A database outage is not evidence that an OTA bundle should be rolled back. Retention/storage cleanup is intentionally conservative; monitor device space before designing removal of old bundles.

## Physical iPhone / iOS 26 acceptance plan

1. Install the unsigned CI IPA with Sideloadly; note native build and version. Test activation, secure configuration, logout/login, branch restrictions, sales, stock transfers, camera scanning and all existing permissions.
2. Open offline: local interface starts; business operations retain online requirements. Reopen/foreground online and verify one bounded update check.
3. Publish a staging bundle with a visible harmless version marker. Confirm the ZIP signature/hash and bundle version; download on Wi-Fi and cellular. Background/interrupt network; ensure bounded retry and no corrupt activation.
4. Test wrong signature/key, cross-origin URL, native build mismatch, wrong platform/channel, stale metadata, stopped rollout, old version, corrupted ZIP, wrong hash and low storage. None may activate.
5. Open an unsaved form or sale: automatic installation must defer. Finish/save, open updater, confirm install. Verify the WebView reloads exactly once and the same IPA installation remains, with configuration/login retained.
6. Use a deliberately broken staging bootstrap (never production): miss notifyAppReady, cold-launch, verify native rollback and failed-version suppression. Test explicit previous and built-in restore offline.
7. Verify later app errors produce optional recovery notice without silently interrupting transactions. Check server outages do not delete settings.
8. Repeat on physical iOS 26 with gesture navigation, rotation, foreground/background and provisioning refresh. Record device, native build, old/new bundle and logs.

A successful CI build is not proof of on-device OTA or Apple distribution approval. Physical iPhone activation/rollback and feature parity remain release gates. No claim of working OTA without reinstalling can be made until step 5 is observed on that device.

## Verification performed

The full regression suite passed 2,213 tests before the final five additional OTA cases; the expanded OTA suite passes 33 cases. Four Cloudflare handler tests cover path isolation, caching, emergency stop and read-only access. TypeScript and ESLint passed. The official Capgo CLI generated a signed local ZIP with a matching SHA-256; nothing was uploaded. GitHub macOS successfully compiled and packaged an unsigned IPA; Android native compilation and the Windows renderer checks also passed. Consult PR #276 for the final commit's check results. Physical iPhone testing, Sideloadly installation, live server deployment and an end-to-end OTA activation are still required before release.

## Adaptive iPhone display (native build 3)

UIKit constrains the complete Capacitor view to its current safe-area layout guide on all four sides. No device model, notch height, corner radius or island width is hard-coded. The OS recalculates these bounds for portrait, landscape and supported window-size changes; web dialogs and fixed controls use the same protected viewport. Keep viewport-fit=contain to avoid adding the hardware inset twice. The native background, status icons and keyboard appearance follow the app theme. Android, Windows and website layout are unchanged.

This is safe-area support around the Dynamic Island, not a Live Activity inside it. iPhone 14/15/16/17/18 models and iOS 27 require physical-device or simulator acceptance before claiming certification. The workflow records its actual Xcode/iOS SDK versions; a passing compile is not proof of testing every OS or model. Test landscape, the keyboard, modal close controls, the home indicator, theme changes and text scaling on each supported size. The native container requires reinstalling this build-3 IPA once; future compatible interface changes can use OTA.

Native build 3 matches the native safe-area surround to the actual CSS palette (including OKLCH), and places both connection states at the top centre. The supported minimum is iOS 26. The owner-approved beta release workflow builds iOS alongside Android/Windows and attaches the unsigned IPA to the same prerelease and immutable Cloudflare beta release directory under ios/. PR builds only upload CI artifacts; they do not publish.

## Connection status and retained setup

A missing saved database profile is shown as “Connection setup required”, not as an internet outage. Backend reachability uses an actual timed request even if the WebView's online hint is stale. Authentication/configuration failures remain closed; this does not grant offline sign-in.

The database URL/key and backend URL retain their existing native secure-store keys (iOS Keychain). Terminal identity and UI preferences retain their existing Capacitor Preferences keys. OTA activation waits for pending preference writes and verifies the current values before reloading; failure postpones activation. Startup cache cleanup does not delete the separate iOS OTA recovery metadata.

For IPA updates, install in place using the same app bundle identifier and signing identity/access group. Deleting the app, resetting its storage or changing the signing identity may lose access to data and is not equivalent to an OTA update. Saved configuration does not bypass session expiry, revocation, branch permissions or login checks; no plaintext login passwords are added. Test an in-place Sideloadly update on the actual device before relying on retention.

## iPhone online business / offline approval parity

iOS uses the existing native terminal, connection, sign-in and online data flows. Apply `20261020033000_allow_ios_mobile_terminal_claim.sql` to the target backend before attempting a new iPhone mobile-token claim; the migration only extends the runtime platform allowlist and retains branch, proof, expiry and single-use rules. This migration is prepared in the PR, not applied automatically by an IPA build. Deploy the matching backend code for iOS/mobile approval receivers.

Enabled users may enroll their own soft token while signed in on a registered iPhone. Keychain stores the secret; a retained matching session, project, terminal and unexpired enrollment are required offline. Logout, expiry or a synchronized permission revocation disables access. Offline revocation cannot be instantaneous; the existing enrollment expiry bounds that interval. Sales, stock and other database operations remain online-only. No offline SQL database is added. Test these flows on a physical iPhone before declaring parity complete.
