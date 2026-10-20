// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "RetailOtaTrust", platforms: [.iOS("15.0")], products: [.library(name: "RetailOtaTrust", targets: ["RetailOtaTrust"])], dependencies: [.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")], targets: [.target(name: "RetailOtaTrust", dependencies: [.product(name: "Capacitor", package: "capacitor-swift-pm")], path: "ios/Sources/RetailOtaTrust")])
