import Foundation
import Capacitor
@objc(RetailOtaTrustPlugin)
public class RetailOtaTrustPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RetailOtaTrustPlugin"
    public let jsName = "RetailOtaTrust"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "configuration", returnType: CAPPluginReturnPromise)]
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
