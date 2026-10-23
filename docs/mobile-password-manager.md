# Phone password-manager integration

The POS saves **staff username/email and account password only after a successful online sign-in**. It asks the device's password manager; it does not write account passwords to POS preferences, SQL Server, Supabase, or the OTA bundle. Cashier, offline-sign-in, approval, and soft-token PINs are separate and are not offered as website passwords. The phone login form also supports filling a previously saved credential. A password-manager prompt can be declined without changing the POS login result.

## Android beta

The generated Android app registers `PosPasswordAutofillPlugin` and includes AndroidX Credential Manager 1.6.0. After a successful password login, Android's credential provider receives a `CreatePasswordRequest` with **no delegated web origin**. The **Use saved password** control requests an app credential using `GetPasswordOption`; the user chooses an entry in the system UI before it reaches the form. The usual WebView AutoFill hints are also present. This requires a **new APK**; an older installed APK cannot gain the native bridge from a web-only update. Check that a password provider is enabled in Android settings. Website/app credential sharing is separate and would require Digital Asset Links and the release certificate fingerprint.

## Sideloaded iPhone beta

The iOS app's signed entitlement must include `webcredentials:beta-pos.luckycharmsdnbhd.com`. That HTTPS host must serve `/.well-known/apple-app-site-association` with `webcredentials.apps` containing the **actual signing Team ID** followed by `.com.luckycharms.pos.beta`. The beta domain Worker has this endpoint, but returns 404 until its `IOS_BETA_TEAM_ID` variable is set to the signing Team ID. A guessed ID would associate a different app and must never be used. The login fields carry Apple's HTML `username`/`current-password` hints. The native bridge calls Apple's shared-web-credential API after a verified login and can request an existing saved login.

The GitHub Actions IPA is unsigned. Sideloadly signs it later, so the build cannot know the final Team ID or verify that Sideloadly kept the bundle ID and Associated Domains entitlement. To obtain them, inspect the **signed** IPA on a Mac:

```sh
unzip -q Retail-iOS-Beta-signed.ipa -d signed-ipa
codesign -dv --verbose=4 signed-ipa/Payload/App.app 2>&1 | grep -E 'TeamIdentifier|Identifier'
codesign -d --entitlements :- signed-ipa/Payload/App.app
```

The signing Team ID is a public 10-character identifier, not an Apple password. Set `IOS_BETA_TEAM_ID` on the `retail-pos-beta-domains` Cloudflare Worker, deploy that Worker, then verify the URL returns the exact signed `TeamIdentifier.bundleID` with HTTP 200, `application/json`, and no redirect. Install a **new IPA** bearing that entitlement. Apple may cache the association; installation or a wait for its CDN to refresh can be necessary. If Sideloadly changed the bundle ID or removed the entitlement, use a signing method/profile that preserves both. Web-bundle OTA cannot add a native entitlement or plugin to an IPA already installed.

The stable iOS app uses the separate `webcredentials:pos.luckycharmsdnbhd.com` entitlement and needs its own association endpoint for its signed Team ID before Passwords saving is enabled there. The beta endpoint never asserts a stable app association.

## Device check

On an iPhone and Android phone with their system password manager enabled, open the **Supervisor / Admin** password tab, enter an active account, and sign in. Confirm the system offers to save or update the credential. Sign out, reopen the tab, tap **Use saved password**, select the saved account, and sign in. A wrong password must still be rejected by the normal server login. Confirm PIN sign-in does not prompt to save a website password. Repeat after installing an update to check that the saved credential remains in the OS password manager.
