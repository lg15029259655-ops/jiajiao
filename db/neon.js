const fs = require("node:fs");
const path = require("node:path");

let pool;

function databaseMode(env = process.env) {
  return String(env.DATABASE_URL || "").trim() ? "neon" : "local";
}

function normalizeConnectionString(connectionString) {
  const url = new URL(connectionString);
  url.searchParams.delete("sslmode");
  return url.toString();
}

function loadEnvFile(filePath = path.join(__dirname, "..", ".env")) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

function getPool() {
  if (databaseMode() !== "neon") throw new Error("DATABASE_URL is required for Neon mode");
  if (!pool) {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: normalizeConnectionString(process.env.DATABASE_URL), ssl: { rejectUnauthorized: true } });
  }
  return pool;
}

async function verifyConnection() {
  const result = await getPool().query("SELECT 1 AS connected");
  return result.rows[0].connected === 1;
}

async function closePool() {
  if (pool) await pool.end();
  pool = undefined;
}

module.exports = { closePool, databaseMode, getPool, loadEnvFile, normalizeConnectionString, verifyConnection };
