import importlib.util
import plistlib
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("bundle_ids", Path(__file__).with_name("verify-ios-bundle-ids.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BundleIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = Path(self.temp.name) / "App.app"
        self.write(self.app, "com.luckycharms.pos.beta")

    def write(self, folder, identifier):
        folder.mkdir(parents=True, exist_ok=True)
        with (folder / "Info.plist").open("wb") as stream:
            plistlib.dump({"CFBundleIdentifier": identifier}, stream, fmt=plistlib.FMT_BINARY)

    def test_unique_binary_plists(self):
        self.write(self.app / "Frameworks/A.framework", "org.cocoapods.A")
        self.write(self.app / "Frameworks/B.framework", "org.cocoapods.B")
        self.assertEqual(len(module.verify(self.app)), 3)

    def test_rejects_framework_collision(self):
        self.write(self.app / "Frameworks/A.framework", "org.cocoapods.duplicate")
        self.write(self.app / "Frameworks/B.framework", "org.cocoapods.duplicate")
        with self.assertRaisesRegex(ValueError, "Duplicate bundle identifier"):
            module.verify(self.app)

    def test_rejects_global_app_override(self):
        self.write(self.app / "Frameworks/A.framework", "com.luckycharms.pos.beta")
        with self.assertRaisesRegex(ValueError, "Duplicate bundle identifier"):
            module.verify(self.app)

    def test_stable_identity_is_distinct(self):
        self.write(self.app, "com.luckycharms.pos")
        self.write(self.app / "Frameworks/A.framework", "org.cocoapods.A")
        self.assertEqual(len(module.verify(self.app, "stable")), 2)
        with self.assertRaisesRegex(ValueError, "Expected app identity"):
            module.verify(self.app, "beta")

    def test_stable_rejects_duplicate_framework_ids(self):
        self.write(self.app, "com.luckycharms.pos")
        self.write(self.app / "Frameworks/A.framework", "org.cocoapods.A")
        self.write(self.app / "Frameworks/B.framework", "org.cocoapods.A")
        with self.assertRaisesRegex(ValueError, "Duplicate bundle identifier"):
            module.verify(self.app, "stable")


if __name__ == "__main__":
    unittest.main()
