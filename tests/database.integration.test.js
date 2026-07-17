const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

const { loadEnvFile, normalizeConnectionString } = require("../db/neon.js");
const { createRepository } = require("../src/repository.js");
const { createBackup } = require("../db/backup.js");
const { restoreIntoSchema } = require("../db/restore.js");

loadEnvFile();

test("Neon temporary schema supports migrations, SQL pagination and optimistic concurrency", {
  skip: process.env.RUN_DB_INTEGRATION !== "1",
  timeout: 120000
}, async () => {
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  assert.ok(connectionString, "database connection is required");
  const schema = `integration_${Date.now()}`;
  const restoreSchema = `${schema}_restore`;
  assert.match(schema, /^integration_[0-9]+$/);
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
      VALUES ('901', 'Integration Staff', 'not-used', 'staff') RETURNING id`);
    const actor = { id: agent.rows[0].id, name: "Integration Staff" };
    const repository = createRepository(pool);
    await assert.rejects(() => pool.query(`INSERT INTO agents (account, display_name, phone, password_hash, role)
      VALUES ('902', 'Conflicting Staff', '901', 'not-used', 'staff')`), { code: "23505" });
    await assert.rejects(() => pool.query(`INSERT INTO orders
      (order_no, grade, subject, score, lesson_time, price, area, address, status)
      VALUES ('BAD-STATUS', '初一', '数学', '60分', '周末', '100元', '雁塔区', '地址', 'pending_review')`), { code: "23514" });
    const order = await repository.createOrder({
      idempotencyKey: `integration-${Date.now()}`, grade: "初二", subject: "数学", area: "雁塔区", score: "80分",
      lessonTime: "周末", price: "100元/小时", address: "集成测试地址"
    }, actor);
    assert.match(order.orderNo, /^XJ\d{10,}$/);
    const edits = await Promise.allSettled([
      repository.updateOrder(order.id, { version: order.version, price: "110元/小时", reason: "并发测试A" }, actor),
      repository.updateOrder(order.id, { version: order.version, price: "120元/小时", reason: "并发测试B" }, actor)
    ]);
    assert.equal(edits.filter((item) => item.status === "fulfilled").length, 1,
      JSON.stringify(edits.map((item) => item.status === "rejected" ? { code: item.reason.code, message: item.reason.message } : { status: "fulfilled" })));
    assert.equal(edits.filter((item) => item.status === "rejected" && item.reason.code === "ORDER_VERSION_CONFLICT").length, 1);

    const importData = { grade: "高一", subject: "物理", area: "碑林区", score: "75分", lessonTime: "周六", price: "150元/小时", address: "批内重复测试地址", parentPhone: "13911112222", rawText: "同一条导入测试订单" };
    const batch = await repository.createImportBatch({ sourceType: "text", filename: "", items: [
      { rowNumber: 1, rawText: importData.rawText, parsedData: importData, warnings: [] },
      { rowNumber: 2, rawText: importData.rawText, parsedData: importData, warnings: [] }
    ] }, actor);
    assert.equal(batch.readyCount, 1);
    assert.equal(batch.needsReviewCount, 1);
    const published = await repository.publishImportBatch(batch.id, actor);
    assert.deepEqual(published, { publishedCount: 1, skippedCount: 1, remainingCount: 0 });

    const freshData = { grade: "初三", subject: "英语", area: "高新区", score: "85分", lessonTime: "周日", price: "130元/小时", address: "发布前复查地址", parentPhone: "13933334444", rawText: "发布前复查订单" };
    const freshBatch = await repository.createImportBatch({ sourceType: "text", filename: "", items: [
      { rowNumber: 1, rawText: freshData.rawText, parsedData: freshData, warnings: [] }
    ] }, actor);
    assert.equal(freshBatch.readyCount, 1);
    await pool.query(`INSERT INTO orders
      (order_no, grade, subject, score, lesson_time, price, area, address, parent_phone, raw_text, status, review_status, published_at)
      VALUES ('FRESH-DUP', $1,$2,$3,$4,$5,$6,$7,$8,$9,'active','published',now())`,
      [freshData.grade, freshData.subject, freshData.score, freshData.lessonTime, freshData.price, freshData.area, freshData.address, freshData.parentPhone, freshData.rawText]);
    assert.deepEqual(await repository.publishImportBatch(freshBatch.id, actor), { publishedCount: 0, skippedCount: 1, remainingCount: 0 });
    const refreshedItem = await pool.query("SELECT review_status FROM import_items WHERE batch_id = $1", [freshBatch.id]);
    assert.equal(refreshedItem.rows[0].review_status, "needs_review");

    await pool.query("INSERT INTO sessions (id, agent_id, expires_at) VALUES ('keep-session', $1, now() + interval '1 day'), ('revoke-session', $1, now() + interval '1 day')", [actor.id]);
    await repository.updateAgentProfile(actor.id, { account: "901", name: "Integration Staff", wechat: "integration901", phone: "", passwordHash: "new-hash", currentSessionDigest: "keep-session" });
    const remainingSessions = await pool.query("SELECT id FROM sessions WHERE agent_id = $1 ORDER BY id", [actor.id]);
    assert.deepEqual(remainingSessions.rows.map((row) => row.id), ["keep-session"]);

    await pool.query(`INSERT INTO orders (order_no, grade, subject, score, lesson_time, price, area, address, status, review_status, published_at)
      SELECT 'T' || lpad(value::text, 6, '0'), '初一', '英语', '70分', '周六', '100元/小时', '高新区', '性能测试地址' || value,
        'active', 'published', now() FROM generate_series(1, 5000) value`);
    const page = await repository.listTeacherOrders({ page: 100 });
    assert.equal(page.items.length, 10);
    assert.equal(page.totalItems, 5003);
    assert.equal(page.pageSize, 10);
    const versions = await pool.query("SELECT max(version)::int AS version FROM schema_migrations");
    assert.equal(versions.rows[0].version, 8);
    const backup = await createBackup(pool);
    await restoreIntoSchema(admin, backup, restoreSchema);
    const restored = await admin.query(`SELECT count(*)::int AS count FROM ${restoreSchema}.orders`);
    assert.equal(restored.rows[0].count, 5003);
    const restoredSequence = await admin.query(`SELECT
      (SELECT COALESCE(MAX(substring(order_no FROM 3)::bigint), 0)
        FROM ${restoreSchema}.orders WHERE order_no ~ '^XJ[0-9]+$') AS max_order_no,
      nextval('${restoreSchema}.order_number_seq') AS next_order_no`);
    assert.ok(Number(restoredSequence.rows[0].next_order_no) > Number(restoredSequence.rows[0].max_order_no));
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${restoreSchema} CASCADE`);
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
