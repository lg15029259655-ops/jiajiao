const fs = require("node:fs");
const path = require("node:path");
const { createPool } = require("../src/database.js");
const { encryptBackup } = require("./backup-format.js");
const { loadEnvFile } = require("./neon.js");

const TABLES = ["agents", "agent_profile_history", "import_batches", "orders", "import_items", "order_logs", "sessions", "order_sequences", "schema_migrations"];

async function createBackup(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tables = {};
    for (const table of TABLES) {
      const result = await client.query(`SELECT * FROM ${table}`);
      tables[table] = result.rows;
    }
    await client.query("COMMIT");
    return { formatVersion: 1, createdAt: new Date().toISOString(), tables };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  loadEnvFile();
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required");
  if (!process.env.BACKUP_ENCRYPTION_KEY) throw new Error("BACKUP_ENCRYPTION_KEY is required");
  const pool = createPool(connectionString, { pooled: false });
  try {
    const payload = await createBackup(pool);
    const encrypted = encryptBackup(payload, process.env.BACKUP_ENCRYPTION_KEY);
    const directory = path.resolve(process.env.BACKUP_DIR || "backups");
    fs.mkdirSync(directory, { recursive: true });
    const filename = `tutor-${new Date().toISOString().replace(/[:.]/g, "-")}.tutorbackup`;
    const output = path.join(directory, filename);
    fs.writeFileSync(output, encrypted, { encoding: "utf8", mode: 0o600 });
    console.log(JSON.stringify({ output, counts: Object.fromEntries(Object.entries(payload.tables).map(([name, rows]) => [name, rows.length])) }));
  } finally {
    await pool.end();
  }
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { TABLES, createBackup };
