const fs = require("node:fs");
const path = require("node:path");
const names = { "pos.approval-token.active.v1": "approval-own-active.enc", "pos.approval-token.locked.v1": "approval-own-locked.enc" };
function createApprovalTokenVault({ safeStorage, directory, binding }) {
 return function access(operation, key, value) {
  if (!Object.hasOwn(names, key) || !["get", "set", "remove"].includes(operation)) throw new Error("Invalid approval vault operation");
  const file = path.join(directory(), names[key]);
  if (operation === "remove") { fs.rmSync(file, { force: true }); return { value: true }; }
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows secure storage is unavailable");
  const identity = binding();
  if (!identity) throw new Error("Register this terminal before using approval tokens");
  if (operation === "get") {
   if (!fs.existsSync(file)) throw new Error("not found");
   const saved = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
   if (saved.binding !== identity) throw new Error("not found");
   return { value: saved.value };
  }
  if (typeof value !== "string" || value.length > 16384) throw new Error("Invalid approval vault value");
  const temporary = file + ".tmp";
  fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify({ binding: identity, value })));
  fs.renameSync(temporary, file);
  return { value: true };
 };
}
module.exports = { createApprovalTokenVault };
