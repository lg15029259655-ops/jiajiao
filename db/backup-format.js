const crypto = require("node:crypto");
const zlib = require("node:zlib");

function encryptBackup(payload, password) {
  if (String(password || "").length < 12) throw new Error("BACKUP_ENCRYPTION_KEY must contain at least 12 characters");
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(payload)));
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  return JSON.stringify({ version: 1, algorithm: "aes-256-gcm+scrypt+gzip", salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
}

function decryptBackup(envelopeText, password) {
  const envelope = JSON.parse(envelopeText);
  if (envelope.version !== 1 || envelope.algorithm !== "aes-256-gcm+scrypt+gzip") throw new Error("Unsupported backup format");
  const key = crypto.scryptSync(password, Buffer.from(envelope.salt, "base64"), 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const compressed = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
  return JSON.parse(zlib.gunzipSync(compressed).toString("utf8"));
}

function validateBackup(payload) {
  if (!payload || payload.formatVersion !== 1 || !payload.createdAt) throw new Error("Backup metadata is invalid");
  if (!payload.tables || typeof payload.tables !== "object") throw new Error("Backup tables are missing");
  const counts = Object.fromEntries(Object.entries(payload.tables).map(([name, rows]) => {
    if (!Array.isArray(rows)) throw new Error(`Backup table ${name} is invalid`);
    return [name, rows.length];
  }));
  return { createdAt: payload.createdAt, counts };
}

module.exports = { decryptBackup, encryptBackup, validateBackup };
