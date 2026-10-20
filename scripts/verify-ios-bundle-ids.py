"""Reject an IPA installation failure before packaging (works with binary plists)."""
import plistlib
import os
import sys
from pathlib import Path


def verify(app, channel="beta"):
    if channel not in ("beta", "stable"):
        raise ValueError("Invalid release channel")
    app = Path(app)
    seen = {}
    for info in sorted(app.rglob("Info.plist")):
        if info.parent.suffix not in (".app", ".framework", ".appex"):
            continue
        with info.open("rb") as stream:
            identifier = plistlib.load(stream).get("CFBundleIdentifier")
        if not identifier:
            raise ValueError(f"Missing bundle identifier: {info}")
        if identifier in seen:
            raise ValueError(f"Duplicate bundle identifier {identifier}: {seen[identifier]} and {info}")
        seen[identifier] = info
    expected = "com.luckycharms.pos.beta" if channel == "beta" else "com.luckycharms.pos"
    if seen.get(expected) != app / "Info.plist":
        raise ValueError("Expected app identity is missing or assigned to a framework")
    if not any(path.parent.suffix == ".framework" for path in seen.values()):
        raise ValueError("Expected embedded frameworks are missing")
    print(f"Verified {len(seen)} unique app/framework bundle identifiers")
    return seen


if __name__ == "__main__":
    verify(sys.argv[1], os.environ.get("POS_RELEASE_CHANNEL", "beta"))
