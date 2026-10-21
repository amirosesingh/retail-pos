import { expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const { createApprovalTokenVault } = createRequire(import.meta.url)("../../../electron/approval-token-vault.cjs");
it("uses only fixed encrypted files and rejects another terminal/project or unavailable OS encryption", () => {
 const root = path.resolve("node_modules/.cache/test-tmp"); fs.mkdirSync(root, { recursive: true });
 const directory = fs.mkdtempSync(path.join(root, "own-token-"));
 if (!directory.startsWith(root + path.sep)) throw new Error("Unexpected test path");
 let binding = "terminal-a|project-a"; let available = true;
 const vault = createApprovalTokenVault({ directory: () => directory, binding: () => binding, safeStorage: {
  isEncryptionAvailable: () => available,
  encryptString: (s: string) => Buffer.from(Buffer.from(s).toString("base64")),
  decryptString: (s: Buffer) => Buffer.from(s.toString(), "base64").toString(),
 } });
 try {
  const key = "pos.approval-token.locked.v1";
  expect(vault("set", key, "protected-envelope")).toEqual({ value: true });
  expect(fs.readFileSync(path.join(directory,"approval-own-locked.enc"),"utf8")).not.toContain("protected-envelope");
  expect(vault("get",key)).toEqual({ value: "protected-envelope" });
  binding = "terminal-b|project-a"; expect(() => vault("get",key)).toThrow("not found");
  expect(() => vault("set","../secret","x")).toThrow("Invalid");
  available = false; expect(() => vault("get",key)).toThrow("unavailable");
  vault("remove",key); expect(fs.existsSync(path.join(directory,"approval-own-locked.enc"))).toBe(false);
 } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});
