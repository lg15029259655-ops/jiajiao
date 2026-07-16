const { Pool } = require("pg");
const { loadEnvFile, normalizeConnectionString } = require("../db/neon.js");

loadEnvFile();

const TRANSIENT_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EPIPE", "57P01", "57P02", "57P03"]);

function isTransientDatabaseError(error) {
  return TRANSIENT_CODES.has(error?.code);
}

async function withTransientRetry(operation) {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientDatabaseError(error)) throw error;
    return operation();
  }
}

function createPool(connectionString = process.env.DATABASE_URL, { pooled = true } = {}) {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const runtimeConnectionString = pooled && process.env.DATABASE_POOL_URL ? process.env.DATABASE_POOL_URL : connectionString;
  const pool = new Pool({
    connectionString: normalizeConnectionString(runtimeConnectionString),
    ssl: { rejectUnauthorized: true },
    max: Number(process.env.DB_POOL_MAX || 10),
    connectionTimeoutMillis: 10000,
    statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 10000),
    query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS || 12000),
    idleTimeoutMillis: 30000,
    keepAlive: true
  });
  pool.on("error", (error) => console.error("Database pool error", error.code || error.message));
  return pool;
}

async function transaction(pool, work) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let client;
    let phase = "connect";
    try {
      client = await pool.connect();
      phase = "begin";
      await client.query("BEGIN");
      phase = "work";
      const result = await work(client);
      phase = "commit";
      await client.query("COMMIT");
      return result;
    } catch (error) {
      if (client && phase !== "connect") await client.query("ROLLBACK").catch(() => {});
      if (attempt === 0 && isTransientDatabaseError(error) && phase !== "commit") continue;
      throw error;
    } finally {
      client?.release();
    }
  }
}

module.exports = { createPool, isTransientDatabaseError, transaction, withTransientRetry };
