const { createPool } = require("../src/database.js");

async function runMaintenance(pool, now = new Date()) {
  const anonymized = await pool.query(`UPDATE orders SET
      parent_name = NULL, parent_phone = NULL, parent_wechat = NULL, raw_text = NULL,
      internal_note = NULL, assigned_teacher_contact = NULL, anonymized_at = $1, updated_at = $1
    WHERE status IN ('completed', 'cancelled', 'deleted')
      AND closed_at IS NOT NULL AND closed_at <= $1::timestamptz - interval '6 months'
      AND anonymized_at IS NULL`, [now]);
  const auditLogs = await pool.query(`UPDATE order_logs SET
      changes = changes - ARRAY['parentName','parentPhone','parentWechat','internalNote','rawText','assignedTeacherContact'],
      reason = NULL
    WHERE (reason IS NOT NULL OR changes ?| ARRAY['parentName','parentPhone','parentWechat','internalNote','rawText','assignedTeacherContact'])
      AND order_id IN (
        SELECT id FROM orders
        WHERE status IN ('completed', 'cancelled', 'deleted') AND anonymized_at IS NOT NULL
      )`);
  const sessions = await pool.query("DELETE FROM sessions WHERE expires_at <= $1", [now]);
  return { anonymizedOrders: anonymized.rowCount, scrubbedAuditLogs: auditLogs.rowCount, deletedSessions: sessions.rowCount };
}

async function main() {
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required");
  const pool = createPool(connectionString, { pooled: false });
  try {
    const result = await runMaintenance(pool);
    console.log(JSON.stringify(result));
  } finally {
    await pool.end();
  }
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { runMaintenance };
