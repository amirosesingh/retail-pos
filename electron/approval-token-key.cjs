const fs = require("node:fs");
const path = require("node:path");
const { generateKeyPairSync, privateDecrypt, createDecipheriv } = require("node:crypto");
function createApprovalKey({ safeStorage, directory, terminal, origin }) {
  function key() {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("Windows credential vault is unavailable");
    const tokenId = terminal()?.tokenId;
    const project = origin();
    if (!tokenId || !project) throw new Error("Registered terminal required");
    const file = path.join(directory(), "approval-verifier-key.enc");
    if (fs.existsSync(file)) {
      const saved = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
      if (saved.tokenId === tokenId && saved.origin === project) return saved;
    }
    const pair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const saved = { ...pair, tokenId, origin: project };
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(saved)));
    fs.renameSync(temporary, file);
    return saved;
  }
  function openEnvelope(envelope) {
    if (!envelope?.ok || !envelope.sealedKey || !envelope.ciphertext)
      throw new Error("Encrypted verifier response required");
    const secret = privateDecrypt(
      { key: key().privateKey, oaepHash: "sha256" },
      Buffer.from(envelope.sealedKey, "base64"),
    );
    const decipher = createDecipheriv("aes-256-gcm", secret, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8"),
    );
  }
  return { publicKey: () => key().publicKey, openEnvelope };
}
module.exports = { createApprovalKey };
