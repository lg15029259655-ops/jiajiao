const crypto = require("node:crypto");

const CURRENT_PASSWORD_ROUNDS = 600000;

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex"), rounds = CURRENT_PASSWORD_ROUNDS) {
  const digest = crypto.pbkdf2Sync(String(password), salt, rounds, 32, "sha256").toString("hex");
  return `pbkdf2$${rounds}$${salt}$${digest}`;
}

function verifyPassword(password, stored) {
  const value = String(stored || "");
  const [scheme, rounds, salt, digest] = value.split("$");
  if (scheme !== "pbkdf2" || !rounds || !salt || !/^[a-f0-9]{64}$/i.test(digest || "")) return false;
  const candidate = crypto.pbkdf2Sync(String(password), salt, Number(rounds), 32, "sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(digest, "hex"));
}

function needsPasswordUpgrade(stored) {
  const [, rounds] = String(stored || "").split("$");
  return Number(rounds || 0) < CURRENT_PASSWORD_ROUNDS;
}

function sessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function tokenDigest(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

module.exports = {
  CURRENT_PASSWORD_ROUNDS,
  hashPassword,
  needsPasswordUpgrade,
  sessionToken,
  tokenDigest,
  verifyPassword
};
