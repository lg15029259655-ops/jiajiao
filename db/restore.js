const fs = require("node:fs");
const path = require("node:path");
const { createPool, transaction } = require("../src/database.js");
const { decryptBackup, validateBackup } = require("./backup-format.js");
const { TABLES } = require("./backup.js");
const { loadEnvFile } = require("./neon.js");
const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
const MIGRATIONS = fs.readdirSync(path.join(__dirname, "migrations")).filter((name) => name.endsWith(".sql")).sort()
  .map((name) => fs.readFileSync(path.join(__dirname, "migrations", name), "utf8"));

function parseArguments(argv) {
  const apply = argv.includes("--apply");
  const target = argv.find((item) => item.startsWith("--target-schema="))?.split("=")[1] || "";
  const file = argv.find((item) => !item.startsWith("--")) || "";
  return { apply, target, file };
}

async function restoreIntoSchema(pool, payload, schema) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema) || schema === "public") throw new Error("Restore target must be a non-public test schema");
  return transaction(pool, async (client) => {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema}, public`);
    await client.query(SCHEMA_SQL);
    for (const migration of MIGRATIONS) await client.query(migration);
    for (const table of [...TABLES].reverse()) await client.query(`DELETE FROM ${table}`);
    for (const table of TABLES) {
      const columnTypes = await client.query(`SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2`, [schema, table]);
      const jsonColumns = new Set(columnTypes.rows.filter((column) => column.data_type === "json" || column.data_type === "jsonb").map((column) => column.column_name));
      const groups = new Map();
      for (const row of payload.tables[table] || []) {
        const signature = Object.keys(row).join("\u0000");
        if (!groups.has(signature)) groups.set(signature, []);
        groups.get(signature).push(row);
      }
      for (const rows of groups.values()) {
        const columns = Object.keys(rows[0]);
        if (!columns.every((column) => /^[a-z_][a-z0-9_]*$/i.test(column))) throw new Error(`Invalid column in ${table}`);
        for (let start = 0; start < rows.length; start += 200) {
          const chunk = rows.slice(start, start + 200);
          const values = [];
          const tuples = chunk.map((row) => {
            const placeholders = columns.map((column) => {
              const value = jsonColumns.has(column) && row[column] !== null ? JSON.stringify(row[column]) : row[column];
              values.push(value);
              return `$${values.length}`;
            });
            return `(${placeholders.join(",")})`;
          });
          await client.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES ${tuples.join(",")}`, values);
        }
      }
    }
    await client.query(`WITH generated AS (
      SELECT COALESCE(MAX(substring(order_no FROM 3)::BIGINT), 0) AS max_value
      FROM orders WHERE order_no ~ '^XJ[0-9]+$'
    )
    SELECT setval('order_number_seq', GREATEST(max_value, 1), max_value > 0)
    FROM generated`);
  });
}

async function main() {
  loadEnvFile();
  const args = parseArguments(process.argv.slice(2));
  if (!args.file) throw new Error("Usage: node db/restore.js <backup-file> --dry-run");
  if (!process.env.BACKUP_ENCRYPTION_KEY) throw new Error("BACKUP_ENCRYPTION_KEY is required");
  const payload = decryptBackup(fs.readFileSync(path.resolve(args.file), "utf8"), process.env.BACKUP_ENCRYPTION_KEY);
  const validation = validateBackup(payload);
  if (!args.apply) {
    console.log(JSON.stringify({ dryRun: true, ...validation }));
    return;
  }
  if (!args.target) throw new Error("--apply requires --target-schema=<non-public-test-schema>");
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  const pool = createPool(connectionString, { pooled: false });
  try {
    await restoreIntoSchema(pool, payload, args.target);
    console.log(JSON.stringify({ restored: true, targetSchema: args.target, ...validation }));
  } finally {
    await pool.end();
  }
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { parseArguments, restoreIntoSchema };
