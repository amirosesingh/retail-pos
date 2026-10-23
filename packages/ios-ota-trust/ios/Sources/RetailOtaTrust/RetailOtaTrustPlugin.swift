import Foundation
import Capacitor
import UIKit
import Security
@objc(RetailOtaTrustPlugin)
public class RetailOtaTrustPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RetailOtaTrustPlugin"
    public let jsName = "RetailOtaTrust"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configuration", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAppearance", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPassword", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "savePassword", returnType: CAPPluginReturnPromise)
    ]
    private var passwordDomain: String {
        getConfig().getString("channel") == "production"
            ? "pos.luckycharmsdnbhd.com" : "beta-pos.luckycharmsdnbhd.com"
    }

    @objc func savePassword(_ call: CAPPluginCall) {
        guard let username = call.getString("username")?.trimmingCharacters(in: .whitespacesAndNewlines),
              !username.isEmpty, let password = call.getString("password"), !password.isEmpty else {
            call.reject("A verified username and password are required.")
            return
        }
        // The system requires a matching webcredentials entitlement and AASA
        // file in the final signed IPA. Neither the POS nor this plugin stores
        // a second copy of the password.
        SecAddSharedWebCredential(passwordDomain as CFString, username as CFString,
                                  password as CFString) { error in
            DispatchQueue.main.async {
                if error == nil { call.resolve() }
                else { call.reject("iPhone Passwords could not save this login.") }
            }
        }
    }

    @objc func requestPassword(_ call: CAPPluginCall) {
        SecRequestSharedWebCredential(passwordDomain as CFString, nil) { credentials, error in
            DispatchQueue.main.async {
                guard error == nil,
                      let entries = credentials as? [NSDictionary],
                      let first = entries.first,
                      let username = first[kSecAttrAccount] as? String,
                      let password = first[kSecSharedPassword] as? String else {
                    call.reject("No saved login was selected.")
                    return
                }
                call.resolve(["username": username, "password": password])
            }
        }
    }
    @objc func setAppearance(_ call: CAPPluginCall) {
        let dark = call.getBool("dark") ?? false
        let rgb = call.getArray("background", Double.self)
        DispatchQueue.main.async {
            let window = self.bridge?.viewController?.view.window
            window?.overrideUserInterfaceStyle = dark ? .dark : .light
            if let rgb = rgb, rgb.count == 3, rgb.allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 255 }) {
                let color = UIColor(red: CGFloat(rgb[0] / 255), green: CGFloat(rgb[1] / 255), blue: CGFloat(rgb[2] / 255), alpha: 1)
                window?.backgroundColor = color
                window?.rootViewController?.view.backgroundColor = color
            }
            call.resolve()
        }
    }
    @objc func configuration(_ call: CAPPluginCall) {
        // Capacitor reads this configuration from the signed application's bundle,
        // not from an OTA bundle or a remote manifest.
        call.resolve([
            "publicKey": getConfig().getString("publicKey") ?? "",
            "endpoint": getConfig().getString("endpoint") ?? "",
            "origin": getConfig().getString("origin") ?? "",
            "channel": getConfig().getString("channel") ?? "staging",
            "appId": getConfig().getString("appId") ?? "",
            "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "",
            "nativeVersion": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        ])
    }
}
