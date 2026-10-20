import Foundation
import Capacitor
import UIKit
@objc(RetailOtaTrustPlugin)
public class RetailOtaTrustPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RetailOtaTrustPlugin"
    public let jsName = "RetailOtaTrust"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configuration", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAppearance", returnType: CAPPluginReturnPromise)
    ]
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
