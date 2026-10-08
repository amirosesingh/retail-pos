import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("desktop release configuration", () => {
  it("uses the stable latest folder for the packaged updater and fallback", () => {
    expect(read("package.json")).toContain("https://updatecms.luckycharmsdnbhd.com/pos-app/latest/");
    expect(read("electron/updater.cjs")).toContain(
      'const DEFAULT_FEED_URL = "https://updatecms.luckycharmsdnbhd.com/pos-app/latest/"',
    );
    expect(read("scripts/desktop-release.cjs")).toContain(
      'const DEFAULT_URL = "https://updatecms.luckycharmsdnbhd.com/pos-app/latest/"',
    );
  });

  it("builds Windows and Android from the same immutable release tag", () => {
    const desktop = read(".github/workflows/desktop-release.yml");
    const android = read(".github/workflows/android-apk.yml");
    const version = read(".github/workflows/version-release.yml");
    const bump = read("scripts/bump-version.cjs");

    expect(version).toContain("version=$(node scripts/bump-version.cjs)");
    expect(version).toContain('while git rev-parse -q --verify "refs/tags/v$version"');
    expect(version).toContain("node scripts/bump-version.cjs --write");
    expect(version).toContain("database/sqlserver/retail-pos-local-database.sql");
    expect(version).toContain("git fetch --tags --force origin");
    expect(version).toContain("git add package.json package-lock.json src/version.ts");
    expect(version).toContain('git tag "$tag"');
    expect(version).toContain(
      'git push --atomic origin HEAD:main "refs/tags/$tag:refs/tags/$tag"',
    );
    expect(version).not.toContain('git push origin HEAD:main');
    expect(version).toContain('gh workflow run desktop-release.yml --ref "$tag"');
    expect(version).toContain('gh workflow run android-apk.yml --ref "$tag"');
    expect(version).toContain("[release]");
    expect(version).toContain("actions: write");

    expect(bump).toContain("package.json is the authoritative application version");
    expect(bump).toContain("syncLockVersion(pkg.version)");
    expect(bump).toContain("fs.writeFileSync(installerPath, installer)");

    expect(desktop).toContain("startsWith(github.ref, 'refs/tags/v')");
    expect(android).toContain("startsWith(github.ref, 'refs/tags/v')");
    expect(desktop).not.toContain("branches: [main]");
    expect(android).not.toContain("branches: [main]");
    expect(desktop).not.toContain("head_commit.message");
    expect(android).not.toContain("head_commit.message");
    expect(desktop).toContain("if: ${{ startsWith(github.ref, 'refs/tags/v') }}");
    expect(android).toContain("!inputs.app_url && startsWith(github.ref, 'refs/tags/v')");
    expect(desktop).not.toContain("GITHUB_RUN_NUMBER");
    expect(android).not.toContain("ANDROID_VERSION_CODE: ${{ github.run_number }}");
  });

  it("publishes the same signed-package manifest from either release job", () => {
    for (const path of [
      ".github/workflows/desktop-release.yml",
      ".github/workflows/android-apk.yml",
    ]) {
      const workflow = read(path);
      expect(workflow).toContain("apkUrl");
      expect(workflow).not.toContain("bundleUrl");
      expect(workflow).toContain("windowsUrl");
      expect(workflow).toContain("s3://updatelccms/pos-app/manifest.json");
    }
    expect(read(".github/workflows/android-apk.yml")).not.toContain("web-latest.zip");
  });

  it("can verify the normal installer from latest.yml", () => {
    const updater = read("electron/updater.cjs");
    expect(updater).toContain('["latest.yml", `${encodeURIComponent(version)}.yml`]');
    expect(updater).toContain("if (fallbackPromise) return fallbackPromise");
    const main = read("electron/main.cjs");
    expect(main).toContain('code: "EACTIVE_SHIFT"');
    expect(main).toContain('match: { closed_at: null }, limit: 1');
    expect(main).not.toContain('["", "ACTIVE", "OPEN"].includes(state)');
  });

  it("publishes Windows without signing credentials and verifies the Android signer", () => {
    const desktop = read(".github/workflows/desktop-release.yml");
    const android = read(".github/workflows/android-apk.yml");
    expect(desktop).not.toContain("WIN_CSC_LINK");
    expect(desktop).not.toContain("WIN_CSC_KEY_PASSWORD");
    expect(desktop).not.toContain("Get-AuthenticodeSignature");
    expect(android).toContain("apksigner\" verify --verbose --print-certs");
    expect(android).toContain("APK signer does not match the configured release keystore alias");
  });
});
