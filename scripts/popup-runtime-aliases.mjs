import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

export const SHARED_POPUP_RUNTIME_MODULES = Object.freeze([
  "@radix-ui/react-dismissable-layer",
  "@radix-ui/react-focus-scope",
]);

// Dialog and Select can install identical versions into different directories.
// Their document-wide focus/Escape/pointer stacks must be one module instance.
// Resolve the existing Dialog-compatible copies, never the older root versions.
const fromDialog = createRequire(import.meta.resolve("@radix-ui/react-dialog"));

export function popupRuntimeAliases() {
  return SHARED_POPUP_RUNTIME_MODULES.map(name => {
    const packageRoot = resolve(dirname(fromDialog.resolve(name)), "..");
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
    if (typeof manifest.module !== "string") throw new Error(`The popup runtime ${name} has no ESM entry.`);
    return { find: new RegExp(`^${name}$`), replacement: resolve(packageRoot, manifest.module) };
  });
}
