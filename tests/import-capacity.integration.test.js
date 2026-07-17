const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

const { loadEnvFile, normalizeConnectionString } = require("../db/neon.js");
const { createRepository } = require("../src/repository.js");

loadEnvFile();

function capacityItems(count) {
  const confidence = Object.fromEntries(["grade", "subject", "area", "score", "lessonTime", "price", "address"].map((field) => [field, "high"]));
  return Array.from({ length: count }, (_, index) => ({
    rowNumber: index + 1,
    rawText: `capacity-order-${index + 1}`,
    parsedData: {
      orderNo: `CAP${String(index + 1).padStart(6, "0")}`,
      grade: "初二", subject: "数学", area: "雁塔区", score: `${60 + (index % 40)}分`,
      lessonTime: "周末", price: `${100 + (index % 20)}元/小时`, address: `容量测试地址${index + 1}`,
      rawText: `capacity-order-${index + 1}`
    },
    fieldConfidence: confidence,
    fieldSources: {}, warnings: [], reviewStatus: "ready",
    contentFingerprint: `capacity-${index + 1}`
  }));
}

test("5000-row staging resumes after 4800 rows and publishes in 50-row chunks", {
  skip: process.env.RUN_DB_CAPACITY !== "1",
  timeout: 180000
}, async () => {
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  assert.ok(connectionString, "database connection is required");
  const schema = `capacity_${Date.now()}`;
  const admin = new Pool({ connectionString: normalizeConnectionString(connectionString), ssl: { rejectUnauthorized: true }, max: 2 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({
    connectionString: normalizeConnectionString(connectionString), ssl: { rejectUnauthorized: true }, max: 5,
    options: `-c search_path=${schema},public`
  });
  try {
    await pool.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));
    for (const file of fs.readdirSync(path.join(__dirname, "../db/migrations")).filter((name) => name.endsWith(".sql")).sort()) {
      await pool.query(fs.readFileSync(path.join(__dirname, "../db/migrations", file), "utf8"));
    }
    const agent = await pool.query(`INSERT INTO agents (account, display_name, password_hash, role)
      VALUES ('951', 'Capacity Staff', 'not-used', 'staff') RETURNING id`);
    const actor = { id: agent.rows[0].id, name: "Capacity Staff", role: "staff" };
    const repository = createRepository(pool);
    const items = capacityItems(5000);
    const batch = await repository.createImportBatch({ sourceType: "spreadsheet", filename: "capacity.xlsx", items }, actor);
    assert.equal(batch.readyCount, 5000);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM import_items WHERE batch_id = $1", [batch.id])).rows[0].count, 5000);

    await pool.query("DELETE FROM import_items WHERE batch_id = $1 AND row_number > 4800", [batch.id]);
    await pool.query(`UPDATE import_batches SET status = 'failed', ready_count = 4800, processed_count = 4800,
      last_processed_row = 4800, failed_count = 200 WHERE id = $1`, [batch.id]);
    const resumed = await repository.resumeImportBatch(batch.id, items, actor);
    assert.equal(resumed.resumedCount, 200);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM import_items WHERE batch_id = $1", [batch.id])).rows[0].count, 5000);

    const published = await repository.publishImportBatch(batch.id, actor);
    assert.deepEqual(published, { publishedCount: 50, skippedCount: 0, remainingCount: 4950 });
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM orders")).rows[0].count, 50);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});

module.exports = { capacityItems };
