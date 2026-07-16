const { getPool } = require("./neon.js");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return UUID.test(String(value || ""));
}

function mapAgent(row) {
  return { id: row.id, account: row.account, name: row.display_name, wechat: row.wechat || "", phone: row.phone || "", passwordHash: row.password_hash, role: row.role, active: row.active };
}

function mapOrder(row) {
  return {
    id: row.id, orderNo: row.order_no, studentGender: row.student_gender || "", grade: row.grade, subject: row.subject,
    score: row.score || "", lessonTime: row.lesson_time, price: row.price, area: row.area, address: row.address,
    requirement: row.teacher_requirement || "", parentName: row.parent_name || "", parentPhone: row.parent_phone || "",
    parentWechat: row.parent_wechat || "", internalNote: row.internal_note || "", rawText: row.raw_text || "",
    assignedTeacherContact: row.assigned_teacher_contact || "", agentId: row.agent_id || "", status: row.status,
    reviewStatus: row.review_status, importBatchId: row.import_batch_id || "", importWarnings: row.import_warnings || [],
    inquiryCount: Number(row.inquiry_count || 0), createdAt: row.created_at, updatedAt: row.updated_at, publishedAt: row.published_at || "",
    agentName: row.agent_name || "中介", agentWechat: row.agent_wechat || "", logs: [], inquiries: []
  };
}

async function loadCloudDb(pool = getPool()) {
  const [agentsResult, ordersResult, batchesResult, logsResult, inquiriesResult] = await Promise.all([
    pool.query("SELECT id, account, display_name, wechat, phone, password_hash, role, active FROM agents ORDER BY created_at"),
    pool.query(`SELECT o.*, a.display_name AS agent_name, a.wechat AS agent_wechat
      FROM orders o LEFT JOIN agents a ON a.id = o.agent_id ORDER BY o.created_at DESC`),
    pool.query("SELECT id, source_type, total_count, ready_count, needs_review_count, published_count, created_by, created_at FROM import_batches ORDER BY created_at DESC"),
    pool.query("SELECT id, order_id, actor_name_snapshot, action, reason, from_status, to_status, created_at FROM order_logs ORDER BY created_at DESC"),
    pool.query("SELECT id, order_id, teacher_contact, note, created_at FROM teacher_inquiries ORDER BY created_at DESC")
  ]);
  const orders = ordersResult.rows.map(mapOrder);
  const byId = new Map(orders.map((order) => [order.id, order]));
  for (const log of logsResult.rows) {
    const order = byId.get(log.order_id);
    if (order) order.logs.push({ _dbId: log.id, at: log.created_at, actor: log.actor_name_snapshot || "系统", action: log.action, reason: log.reason || "", from: log.from_status || "", to: log.to_status || "" });
  }
  for (const inquiry of inquiriesResult.rows) {
    const order = byId.get(inquiry.order_id);
    if (order) order.inquiries.push({ _dbId: inquiry.id, at: inquiry.created_at, contact: inquiry.teacher_contact || "", note: inquiry.note || "" });
  }
  return {
    agents: agentsResult.rows.map(mapAgent),
    orders,
    importBatches: batchesResult.rows.map((batch) => ({ id: batch.id, sourceType: batch.source_type, totalCount: batch.total_count, readyCount: batch.ready_count, needsReviewCount: batch.needs_review_count, publishedCount: batch.published_count, createdBy: batch.created_by || "", createdAt: batch.created_at })),
    backups: [], version: 5
  };
}

async function saveCloudDb(db, pool = getPool()) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const agentIds = new Map();
    for (const agent of db.agents || []) {
      let result;
      if (isUuid(agent.id)) {
        result = await client.query(`INSERT INTO agents (id, account, display_name, wechat, phone, password_hash, role, active, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
          ON CONFLICT (id) DO UPDATE SET account=EXCLUDED.account, display_name=EXCLUDED.display_name, wechat=EXCLUDED.wechat, phone=EXCLUDED.phone, password_hash=EXCLUDED.password_hash, role=EXCLUDED.role, active=EXCLUDED.active, updated_at=now()
          RETURNING id`, [agent.id, agent.account, agent.name, agent.wechat || null, agent.phone || null, agent.passwordHash, agent.role, agent.active !== false]);
      } else {
        result = await client.query(`INSERT INTO agents (account, display_name, wechat, phone, password_hash, role, active)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (account) DO UPDATE SET display_name=EXCLUDED.display_name, wechat=EXCLUDED.wechat, phone=EXCLUDED.phone, password_hash=EXCLUDED.password_hash, role=EXCLUDED.role, active=EXCLUDED.active, updated_at=now()
          RETURNING id`, [agent.account, agent.name, agent.wechat || null, agent.phone || null, agent.passwordHash, agent.role, agent.active !== false]);
      }
      agentIds.set(String(agent.id), result.rows[0].id);
      agent.id = result.rows[0].id;
    }
    const batchIds = new Map();
    for (const batch of db.importBatches || []) {
      const sourceType = batch.sourceType === "spreadsheet" ? "spreadsheet" : "text";
      const values = [sourceType, agentIds.get(String(batch.createdBy)) || batch.createdBy || null, Number(batch.totalCount || 0), Number(batch.readyCount || 0), Number(batch.needsReviewCount || 0), Number(batch.publishedCount || 0), batch.createdAt || new Date().toISOString()];
      const result = isUuid(batch.id)
        ? await client.query(`INSERT INTO import_batches (id, source_type, created_by, total_count, ready_count, needs_review_count, published_count, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET total_count=EXCLUDED.total_count, ready_count=EXCLUDED.ready_count, needs_review_count=EXCLUDED.needs_review_count, published_count=EXCLUDED.published_count RETURNING id`, [batch.id, ...values])
        : await client.query("INSERT INTO import_batches (source_type, created_by, total_count, ready_count, needs_review_count, published_count, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id", values);
      batchIds.set(String(batch.id), result.rows[0].id);
      batch.id = result.rows[0].id;
    }
    for (const order of db.orders || []) {
      const values = [order.orderNo, order.studentGender || null, order.grade, order.subject, order.score || null, order.lessonTime, order.price, order.area, order.address, order.requirement || null, order.parentName || null, order.parentPhone || null, order.parentWechat || null, order.internalNote || null, order.rawText || null, order.assignedTeacherContact || null, agentIds.get(String(order.agentId)) || order.agentId || null, order.status, order.reviewStatus || "published", batchIds.get(String(order.importBatchId)) || order.importBatchId || null, JSON.stringify(order.importWarnings || []), Number(order.inquiryCount || 0), order.createdAt || new Date().toISOString(), order.updatedAt || new Date().toISOString()];
      const result = isUuid(order.id)
        ? await client.query(`INSERT INTO orders (id, order_no, student_gender, grade, subject, score, lesson_time, price, area, address, teacher_requirement, parent_name, parent_phone, parent_wechat, internal_note, raw_text, assigned_teacher_contact, agent_id, status, review_status, import_batch_id, import_warnings, inquiry_count, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23,$24,$25)
          ON CONFLICT (id) DO UPDATE SET order_no=EXCLUDED.order_no, student_gender=EXCLUDED.student_gender, grade=EXCLUDED.grade, subject=EXCLUDED.subject, score=EXCLUDED.score, lesson_time=EXCLUDED.lesson_time, price=EXCLUDED.price, area=EXCLUDED.area, address=EXCLUDED.address, teacher_requirement=EXCLUDED.teacher_requirement, parent_name=EXCLUDED.parent_name, parent_phone=EXCLUDED.parent_phone, parent_wechat=EXCLUDED.parent_wechat, internal_note=EXCLUDED.internal_note, raw_text=EXCLUDED.raw_text, assigned_teacher_contact=EXCLUDED.assigned_teacher_contact, agent_id=EXCLUDED.agent_id, status=EXCLUDED.status, review_status=EXCLUDED.review_status, import_batch_id=EXCLUDED.import_batch_id, import_warnings=EXCLUDED.import_warnings, inquiry_count=EXCLUDED.inquiry_count, updated_at=EXCLUDED.updated_at RETURNING id`, [order.id, ...values])
        : await client.query(`INSERT INTO orders (order_no, student_gender, grade, subject, score, lesson_time, price, area, address, teacher_requirement, parent_name, parent_phone, parent_wechat, internal_note, raw_text, assigned_teacher_contact, agent_id, status, review_status, import_batch_id, import_warnings, inquiry_count, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22,$23,$24) RETURNING id`, values);
      const orderId = result.rows[0].id;
      order.id = orderId;
      for (const log of order.logs || []) {
        if (log._dbId) continue;
        const inserted = await client.query("INSERT INTO order_logs (order_id, actor_name_snapshot, action, reason, from_status, to_status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id", [orderId, log.actor || null, log.action || "系统操作", log.reason || null, log.from || null, log.to || null, log.at || new Date().toISOString()]);
        log._dbId = inserted.rows[0].id;
      }
      for (const inquiry of order.inquiries || []) {
        if (inquiry._dbId) continue;
        const inserted = await client.query("INSERT INTO teacher_inquiries (order_id, teacher_contact, note, created_at) VALUES ($1,$2,$3,$4) RETURNING id", [orderId, inquiry.contact || null, inquiry.note || null, inquiry.at || new Date().toISOString()]);
        inquiry._dbId = inserted.rows[0].id;
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { loadCloudDb, saveCloudDb };
