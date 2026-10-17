const fs = require("node:fs");
const path = require("node:path");
const [mode, directory] = process.argv.slice(2);
if (!["web", "native"].includes(mode) || !directory) throw new Error("Usage: node scripts/verify-approval-build.cjs web|native <client-directory>");
const markers = ["pos.approval-token.active.v1", "Enable soft token (TOTP)", "Your approval token"];
const found = new Set(); let files = 0;
function visit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(target);
    else if (entry.name.endsWith(".js")) {
      files++; const code = fs.readFileSync(target, "utf8");
      for (const marker of markers) if (code.includes(marker)) found.add(marker);
    }
  }
}
visit(path.resolve(directory));
if (!files) throw new Error("No built client JavaScript was found");
if (mode === "web" && found.size) throw new Error("Native approval code leaked into the website client");
if (mode === "native" && found.size !== markers.length) throw new Error("Native approval features are missing from the device client");
console.log(`Approval build boundary verified: ${mode}, ${files} JavaScript files`);
