const fs = require("node:fs");
const path = require("node:path");
const { closePool, getPool, loadEnvFile } = require("./neon.js");

const ROOT = path.join(__dirname, "..");
const DEFAULT_SOURCE = path.join(ROOT, "data", "platform-db.json");
const SCHEMA_PATH = path.join(__dirname, "schema.sql");
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

function readPrototypeData(sourcePath = DEFAULT_SOURCE) {
  if (!fs.existsSync(sourcePath)) return { agents: [], orders: [], importBatches: [] };
  const data = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  return { agents: data.agents || [], orders: data.orders || [], importBatches: data.importBatches || [] };
}

async function applySchema(pool = getPool()) {
  await pool.query(fs.readFileSync(SCHEMA_PATH, "utf8"));
}

async function applyMigrations(pool = getPool()) {
  if (!fs.existsSync(MIGRATIONS_DIR)) return;
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) await pool.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
}

async function migratePrototypeData({ pool = getPool(), sourcePath = DEFAULT_SOURCE } = {}) {
  const source = readPrototypeData(sourcePath);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT count(*)::int AS count FROM agents");
    if (existing.rows[0].count > 0) {
      await client.query("ROLLBACK");
      return { skipped: true, reason: "cloud database already contains agents" };
    }

    const agentIds = new Map();
    for (const agent of source.agents) {
      const result = await client.query(
        `INSERT INTO agents (account, display_name, wechat, phone, password_hash, role, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [agent.account, agent.name || agent.displayName || "中介", agent.wechat || null, agent.phone || null, agent.passwordHash, agent.role || "staff", agent.active !== false]
      );
      agentIds.set(String(agent.id), result.rows[0].id);
    }

    const batchIds = new Map();
    for (const batch of source.importBatches) {
      const result = await client.query(
        `INSERT INTO import_batches (source_type, created_by, total_count, ready_count, needs_review_count, published_count, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [batch.sourceType === "spreadsheet" ? "spreadsheet" : "text", agentIds.get(String(batch.createdBy)) || null, Number(batch.totalCount || 0), Number(batch.readyCount || 0), Number(batch.needsReviewCount || 0), Number(batch.publishedCount || 0), batch.createdAt || new Date().toISOString()]
      );
      batchIds.set(String(batch.id), result.rows[0].id);
    }

    let logCount = 0;
    for (const order of source.orders) {
      const result = await client.query(
        `INSERT INTO orders (
          order_no, student_gender, grade, subject, score, lesson_time, price, area, address,
          teacher_requirement, parent_name, parent_phone, parent_wechat, internal_note, raw_text,
          assigned_teacher_contact, agent_id, status, review_status, import_batch_id, import_warnings,
          inquiry_count, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22,$23,$24
        ) RETURNING id`,
        [
          order.orderNo, order.studentGender || null, order.grade, order.subject, order.score || null, order.lessonTime,
          order.price, order.area, order.address, order.requirement || null, order.parentName || null, order.parentPhone || null,
          order.parentWechat || null, order.internalNote || null, order.rawText || null, order.assignedTeacherContact || null,
          agentIds.get(String(order.agentId)) || null, order.status || "pending_review", order.reviewStatus || "needs_review",
          batchIds.get(String(order.importBatchId)) || null, JSON.stringify(order.importWarnings || []), Number(order.inquiryCount || 0),
          order.createdAt || new Date().toISOString(), order.updatedAt || order.createdAt || new Date().toISOString()
        ]
      );
      const orderId = result.rows[0].id;
      for (const log of order.logs || []) {
        await client.query(
          `INSERT INTO order_logs (order_id, actor_name_snapshot, action, reason, from_status, to_status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [orderId, log.actor || null, log.action || "导入记录", log.reason || null, log.from || null, log.to || null, log.at || order.createdAt || new Date().toISOString()]
        );
        logCount += 1;
      }
    }
    await client.query("COMMIT");
    return { skipped: false, agents: source.agents.length, orders: source.orders.length, batches: source.importBatches.length, logs: logCount };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  loadEnvFile();
  if (process.env.DATABASE_DIRECT_URL) process.env.DATABASE_URL = process.env.DATABASE_DIRECT_URL;
  const pool = getPool();
  await applySchema(pool);
  await applyMigrations(pool);
  console.log(JSON.stringify(await migratePrototypeData({ pool })));
  await closePool();
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(error.message);
    await closePool();
    process.exitCode = 1;
  });
}

module.exports = { applyMigrations, applySchema, migratePrototypeData, readPrototypeData };
