const { ACTIVE_STATUSES, HISTORY_STATUSES, assertTransition, domainError } = require("./domain.js");
const crypto = require("node:crypto");
const { transaction, withTransientRetry } = require("./database.js");
const { validateImportItem } = require("./imports.js");

const PAGE_SIZE = 10;
const SENSITIVE_AUDIT_FIELDS = new Set(["parentName", "parentPhone", "parentWechat", "internalNote", "rawText", "assignedTeacherContact"]);
const AUTOMATIC_ORDER_NO_PATTERN = /^XJ\d+$/i;

function assertManualOrderNoAllowed(value, existingOrderNo = "") {
  const orderNo = String(value || "").trim();
  if (AUTOMATIC_ORDER_NO_PATTERN.test(orderNo)) {
    const current = String(existingOrderNo || "").trim();
    if (current && orderNo.toUpperCase() === current.toUpperCase()) return current;
    throw domainError("ORDER_NO_RESERVED", "XJ开头的编号由系统自动生成，请使用其他订单号或留空", 400);
  }
  return orderNo;
}

function normalizePage(page) {
  const value = Number(page || 1);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function assertRequiredOrderFields(data) {
  const required = [["grade", "年级"], ["subject", "科目"], ["area", "区域"], ["score", "当前成绩"], ["lessonTime", "补习时间"], ["price", "报价"], ["roughAddress", "粗略地址"], ["address", "详细地址"], ["parentWechat", "家长微信"]];
  const missing = required.filter(([key]) => !String(data[key] || "").trim()).map(([, label]) => label);
  if (missing.length) throw domainError("ORDER_FIELDS_REQUIRED", `请补全：${missing.join("、")}`, 400);
}

function assertPublishingActor(actor) {
  if (actor?.role === "staff" && !String(actor.wechat || "").trim()) {
    throw domainError("AGENT_WECHAT_REQUIRED", "请先在账号安全中填写中介微信，再发布订单", 400);
  }
}

function placeholders(values, startAt) {
  return values.map((_, index) => `$${startAt + index}`);
}

function buildTeacherOrderQuery(options = {}) {
  const values = [];
  const where = ["o.status = 'active'"];
  if (options.grades?.length) {
    values.push(options.grades);
    where.push(`o.grade = ANY($${values.length})`);
  }
  if (options.subjects?.length) {
    values.push(options.subjects.map((item) => `%${item}%`));
    where.push(`o.subject ILIKE ANY($${values.length})`);
  }
  if (options.areas?.length) {
    values.push(options.areas);
    where.push(`o.area = ANY($${values.length})`);
  }
  if (String(options.keyword || "").trim()) {
    values.push(`%${String(options.keyword).trim()}%`);
    const p = `$${values.length}`;
    where.push(`(o.order_no ILIKE ${p} OR o.rough_address ILIKE ${p} OR o.teacher_requirement ILIKE ${p})`);
  }
  values.push((normalizePage(options.page) - 1) * PAGE_SIZE);
  return {
    text: `SELECT o.id, o.order_no, o.status, o.student_gender, o.grade, o.subject, o.score,
      o.lesson_time, o.start_time_text, o.lesson_frequency, o.lesson_duration,
      o.price, o.area, o.rough_address AS address, o.teacher_requirement, o.teacher_gender_requirement,
      o.teacher_education_requirement, o.created_at, o.updated_at,
      a.display_name AS agent_name, a.wechat AS agent_wechat, COUNT(*) OVER() AS total_count
      FROM orders o LEFT JOIN agents a ON a.id = o.agent_id
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE(o.published_at, o.created_at) DESC, o.id DESC
      LIMIT 10 OFFSET $${values.length}`,
    values
  };
}

function buildAgentOrderQuery(options = {}) {
  const scopeStatuses = options.scope === "history" ? HISTORY_STATUSES : ACTIVE_STATUSES;
  const values = [[...scopeStatuses]];
  const where = ["o.status = ANY($1)"];
  if (options.status && scopeStatuses.includes(options.status)) {
    values.push(options.status);
    where.push(`o.status = $${values.length}`);
  }
  if (options.followup === "lockOverdue") {
    where.push("o.status = 'paused' AND o.lock_follow_up_at <= now()");
  } else if (options.followup === "stale7") {
    where.push("o.status = 'active' AND o.updated_at <= now() - interval '7 days'");
  } else if (options.followup === "stale14") {
    where.push("o.status = 'active' AND o.updated_at <= now() - interval '14 days'");
  }
  if (String(options.keyword || "").trim()) {
    values.push(`%${String(options.keyword).trim()}%`);
    const p = `$${values.length}`;
    where.push(`(o.order_no ILIKE ${p} OR o.address ILIKE ${p} OR o.grade ILIKE ${p} OR o.subject ILIKE ${p}
      OR o.parent_phone ILIKE ${p} OR o.parent_wechat ILIKE ${p} OR o.raw_text ILIKE ${p})`);
  }
  values.push((normalizePage(options.page) - 1) * PAGE_SIZE);
  return {
    text: `SELECT o.*, a.display_name AS agent_name, a.wechat AS agent_wechat,
      COUNT(*) OVER() AS total_count
      FROM orders o LEFT JOIN agents a ON a.id = o.agent_id
      WHERE ${where.join(" AND ")}
      ORDER BY o.updated_at DESC, o.id DESC
      LIMIT 10 OFFSET $${values.length}`,
    values
  };
}

function mapAgent(row) {
  return {
    id: row.id, account: row.account, name: row.display_name, wechat: row.wechat || "", phone: row.phone || "",
    passwordHash: row.password_hash, role: row.role, active: row.active, mustChangePassword: row.must_change_password === true
  };
}

function mapOrder(row) {
  return {
    id: row.id, orderNo: row.order_no, studentGender: row.student_gender || "", grade: row.grade || "",
    subject: row.subject || "", score: row.score || "", lessonTime: row.lesson_time || "",
    startTimeText: row.start_time_text || "", lessonFrequency: row.lesson_frequency || "", lessonDuration: row.lesson_duration || "",
    price: row.price || "",
    area: row.area || "", roughAddress: row.rough_address || row.address || "", address: row.address || "", requirement: row.teacher_requirement || "",
    teacherGenderRequirement: row.teacher_gender_requirement || "",
    teacherEducationRequirement: row.teacher_education_requirement || "",
    parentName: row.parent_name || "", parentPhone: row.parent_phone || "", parentWechat: row.parent_wechat || "",
    internalNote: row.internal_note || "", rawText: row.raw_text || "", assignedTeacherContact: row.assigned_teacher_contact || "",
    agentId: row.agent_id || "", agentName: row.agent_name || "中介", agentWechat: row.agent_wechat || "",
    status: row.status, version: Number(row.version || 1), createdAt: row.created_at || "", updatedAt: row.updated_at || "",
    lockedByAgentId: row.locked_by_agent_id || "", lockedAt: row.locked_at || "",
    lockFollowUpAt: row.lock_follow_up_at || "",
    lockOverdue: row.status === "paused" && Boolean(row.lock_follow_up_at) && new Date(row.lock_follow_up_at) <= new Date(),
    staleLevel: row.status === "active" ? staleLevel(row.updated_at) : "",
    closedAt: row.closed_at || "", anonymizedAt: row.anonymized_at || ""
  };
}

function staleLevel(updatedAt, now = new Date()) {
  if (!updatedAt) return "";
  const ageDays = (now.getTime() - new Date(updatedAt).getTime()) / 86400000;
  if (ageDays >= 14) return "critical";
  if (ageDays >= 7) return "warning";
  return "";
}

function mapImportItem(row) {
  return {
    id: row.id, batchId: row.batch_id, rowNumber: row.row_number, rawText: row.raw_text || "",
    parsedData: row.parsed_data || {}, warnings: row.warnings || [], reviewStatus: row.review_status,
    fieldConfidence: row.field_confidence || {}, fieldSources: row.field_sources || {},
    contentFingerprint: row.content_fingerprint || "", errorCategory: row.error_category || "",
    duplicateConfirmed: row.duplicate_confirmed === true, publishedOrderId: row.published_order_id || "",
    version: Number(row.version || 1), updatedAt: row.updated_at || ""
  };
}

function pageResult(rows, page) {
  const currentPage = normalizePage(page);
  const totalItems = Number(rows[0]?.total_count || 0);
  return { items: rows.map(mapOrder), page: currentPage, pageSize: PAGE_SIZE, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / PAGE_SIZE)) };
}

async function databaseDuplicateWarnings(client, data, excludeOrderId = null, excludeBatchId = null) {
  const values = [
    String(data.orderNo || "").trim(), String(data.parentPhone || "").trim(), String(data.parentWechat || "").trim(),
    String(data.address || "").trim(), String(data.grade || "").trim(), String(data.subject || "").trim(),
    String(data.rawText || "").trim(), excludeOrderId, excludeBatchId
  ];
  const result = await client.query(`SELECT order_no, parent_phone, parent_wechat, address, grade, subject, raw_text
    FROM orders WHERE ($8::uuid IS NULL OR id <> $8)
      AND ($9::uuid IS NULL OR import_batch_id IS DISTINCT FROM $9)
      AND (($1 <> '' AND order_no = $1)
        OR ($2 <> '' AND parent_phone = $2)
        OR ($3 <> '' AND parent_wechat = $3)
        OR ($4 <> '' AND $5 <> '' AND $6 <> '' AND address = $4 AND grade = $5 AND subject = $6)
        OR ($7 <> '' AND raw_text IS NOT NULL AND similarity(raw_text, $7) >= 0.65))
    LIMIT 10`, values);
  const warnings = new Set();
  for (const row of result.rows) {
    if (values[0] && row.order_no === values[0]) warnings.add("订单号相同");
    if ((values[1] && row.parent_phone === values[1]) || (values[2] && row.parent_wechat === values[2])) warnings.add("家长微信/电话相同");
    if (values[3] && row.address === values[3] && row.grade === values[4] && row.subject === values[5]) warnings.add("地址 + 年级 + 科目相同");
    if (values[6] && row.raw_text) warnings.add("原始文本高度相似");
  }
  return [...warnings];
}

async function databaseDuplicateWarningsForItems(client, items) {
  if (!items.length) return new Map();
  const payload = items.map((item) => ({
    row_number: item.rowNumber,
    order_no: String(item.parsedData?.orderNo || "").trim(),
    parent_phone: String(item.parsedData?.parentPhone || "").trim(),
    parent_wechat: String(item.parsedData?.parentWechat || "").trim(),
    address: String(item.parsedData?.address || "").trim(),
    grade: String(item.parsedData?.grade || "").trim(),
    subject: String(item.parsedData?.subject || "").trim(),
    raw_text: String(item.parsedData?.rawText || item.rawText || "").trim()
  }));
  const result = await client.query(`WITH incoming AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
        row_number integer, order_no text, parent_phone text, parent_wechat text,
        address text, grade text, subject text, raw_text text
      )
    )
    SELECT i.row_number,
      bool_or(i.order_no <> '' AND o.order_no = i.order_no) AS same_order_no,
      bool_or((i.parent_phone <> '' AND o.parent_phone = i.parent_phone)
        OR (i.parent_wechat <> '' AND o.parent_wechat = i.parent_wechat)) AS same_contact,
      bool_or(i.address <> '' AND i.grade <> '' AND i.subject <> ''
        AND o.address = i.address AND o.grade = i.grade AND o.subject = i.subject) AS same_core,
      bool_or(i.raw_text <> '' AND o.raw_text IS NOT NULL AND similarity(o.raw_text, i.raw_text) >= 0.65) AS same_raw
    FROM incoming i JOIN orders o ON o.status <> 'deleted' AND (
      (i.order_no <> '' AND o.order_no = i.order_no)
      OR (i.parent_phone <> '' AND o.parent_phone = i.parent_phone)
      OR (i.parent_wechat <> '' AND o.parent_wechat = i.parent_wechat)
      OR (i.address <> '' AND i.grade <> '' AND i.subject <> ''
        AND o.address = i.address AND o.grade = i.grade AND o.subject = i.subject)
      OR (i.raw_text <> '' AND o.raw_text IS NOT NULL AND similarity(o.raw_text, i.raw_text) >= 0.65)
    ) GROUP BY i.row_number`, [JSON.stringify(payload)]);
  const warnings = new Map();
  for (const row of result.rows) {
    const values = [];
    if (row.same_order_no) values.push("订单号相同");
    if (row.same_contact) values.push("家长微信/电话相同");
    if (row.same_core) values.push("地址 + 年级 + 科目相同");
    if (row.same_raw) values.push("原始文本高度相似");
    warnings.set(Number(row.row_number), values);
  }
  return warnings;
}

function classifyImportError(warnings) {
  if (warnings.some((warning) => warning.includes("重复") || warning.includes("相同") || warning.includes("相似"))) return "duplicate";
  if (warnings.some((warning) => warning.startsWith("缺少"))) return "missing_fields";
  if (warnings.some((warning) => warning.startsWith("识别不确定"))) return "low_confidence";
  return "";
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function pendingImportItems(items, lastProcessedRow = 0, existingRows = []) {
  const existing = new Set(existingRows.map(Number));
  return items.filter((item) => {
    const rowNumber = Number(item.rowNumber || 0);
    return rowNumber > Number(lastProcessedRow || 0) && !existing.has(rowNumber);
  });
}

function createImportDuplicateIndex(items = []) {
  const index = { orderNos: new Set(), contacts: new Set(), coreFields: new Set(), rawTexts: new Set() };
  for (const item of items) addImportToDuplicateIndex(index, item);
  return index;
}

function cloneImportDuplicateIndex(index) {
  return {
    orderNos: new Set(index.orderNos), contacts: new Set(index.contacts),
    coreFields: new Set(index.coreFields), rawTexts: new Set(index.rawTexts)
  };
}

function normalizedIndexValue(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function addImportToDuplicateIndex(index, data) {
  if (data?.status === "deleted") return index;
  const orderNo = normalizedIndexValue(data?.orderNo);
  const phone = normalizedIndexValue(data?.parentPhone);
  const wechat = normalizedIndexValue(data?.parentWechat);
  const address = normalizedIndexValue(data?.address);
  const grade = normalizedIndexValue(data?.grade);
  const subject = normalizedIndexValue(data?.subject);
  const rawText = normalizedIndexValue(data?.rawText);
  if (orderNo) index.orderNos.add(orderNo);
  if (phone) index.contacts.add(phone);
  if (wechat) index.contacts.add(wechat);
  if (address && grade && subject) index.coreFields.add(`${address}\u0000${grade}\u0000${subject}`);
  if (rawText) index.rawTexts.add(rawText);
  return index;
}

function duplicateWarningsFromIndex(data, index) {
  const warnings = [];
  const orderNo = normalizedIndexValue(data?.orderNo);
  const phone = normalizedIndexValue(data?.parentPhone);
  const wechat = normalizedIndexValue(data?.parentWechat);
  const address = normalizedIndexValue(data?.address);
  const grade = normalizedIndexValue(data?.grade);
  const subject = normalizedIndexValue(data?.subject);
  const rawText = normalizedIndexValue(data?.rawText);
  if (orderNo && index.orderNos.has(orderNo)) warnings.push("订单号相同");
  if ((phone && index.contacts.has(phone)) || (wechat && index.contacts.has(wechat))) warnings.push("家长微信/电话相同");
  if (address && grade && subject && index.coreFields.has(`${address}\u0000${grade}\u0000${subject}`)) warnings.push("地址 + 年级 + 科目相同");
  if (rawText && index.rawTexts.has(rawText)) warnings.push("原始文本相同");
  return warnings;
}

async function insertImportItems(client, batchId, items) {
  if (!items.length) return [];
  const columnsPerRow = 10;
  const values = [];
  const rows = items.map((item, rowIndex) => {
    const start = rowIndex * columnsPerRow + 1;
    values.push(
      batchId, item.rowNumber, item.rawText || null, item.parsedData || {}, JSON.stringify(item.warnings || []),
      item.reviewStatus, item.fieldConfidence || {}, item.fieldSources || {}, item.contentFingerprint || null,
      item.errorCategory || null
    );
    return `(${Array.from({ length: columnsPerRow }, (_, index) => `$${start + index}`).join(",")})`;
  });
  const inserted = await client.query(`INSERT INTO import_items
    (batch_id, row_number, raw_text, parsed_data, warnings, review_status,
      field_confidence, field_sources, content_fingerprint, error_category)
    VALUES ${rows.join(",")}
    ON CONFLICT (batch_id, row_number) DO NOTHING RETURNING *`, values);
  return inserted.rows;
}

async function allocateOrderNo(client) {
  const sequence = await client.query(`SELECT 'XJ' || lpad(nextval('order_number_seq')::text, 10, '0') AS order_no`);
  return sequence.rows[0].order_no;
}

function createRepository(pool) {
  const query = (text, values = []) => withTransientRetry(() => pool.query(text, values));
  return {
    async ping() {
      const result = await query("SELECT 1 AS ok");
      return Number(result.rows[0]?.ok) === 1;
    },
    async listTeacherOrders(options) {
      const statement = buildTeacherOrderQuery(options);
      const result = await query(statement.text, statement.values);
      return pageResult(result.rows, options.page);
    },
    async listAgentOrders(options) {
      const statement = buildAgentOrderQuery(options);
      const [orders, counts] = await Promise.all([
        query(statement.text, statement.values),
        query("SELECT status, count(*)::int AS count FROM orders GROUP BY status")
      ]);
      return { ...pageResult(orders.rows, options.page), counts: Object.fromEntries(counts.rows.map((row) => [row.status, Number(row.count)])) };
    },
    async findAgentByLogin(account) {
      const result = await query(`SELECT id, account, display_name, wechat, phone, password_hash, role, active, must_change_password
        FROM agents WHERE active = TRUE AND ($1 = account OR $1 = phone OR $1 = wechat) LIMIT 1`, [account]);
      return result.rows[0] ? mapAgent(result.rows[0]) : null;
    },
    async upgradePassword(agentId, passwordHash) {
      await query("UPDATE agents SET password_hash = $2, updated_at = now() WHERE id = $1", [agentId, passwordHash]);
    },
    async createSession({ digest, agentId, expiresAt, userAgent, ip }) {
      const ipHash = crypto.createHash("sha256").update(String(ip || "")).digest("hex");
      await query(`INSERT INTO sessions (id, agent_id, expires_at, last_seen_at, user_agent, ip_hash)
        VALUES ($1, $2, $3, now(), $4, $5)
        ON CONFLICT (id) DO UPDATE SET expires_at = EXCLUDED.expires_at, last_seen_at = now()`, [digest, agentId, expiresAt, userAgent || null, ipHash]);
    },
    async getSessionAgent(digest) {
      const result = await query(`WITH active_session AS (
          UPDATE sessions SET last_seen_at = now() WHERE id = $1 AND expires_at > now() RETURNING agent_id
        ) SELECT a.id, a.account, a.display_name, a.wechat, a.phone, a.password_hash,
          a.role, a.active, a.must_change_password
        FROM active_session s JOIN agents a ON a.id = s.agent_id WHERE a.active = TRUE`, [digest]);
      return result.rows[0] ? mapAgent(result.rows[0]) : null;
    },
    async deleteSession(digest) {
      await query("DELETE FROM sessions WHERE id = $1", [digest]);
    },
    async listAgents() {
      const result = await query("SELECT id, account, display_name, wechat, phone, password_hash, role, active, must_change_password FROM agents ORDER BY role, account");
      return result.rows.map(mapAgent);
    },
    async updateAgentProfile(agentId, input) {
      return transaction(pool, async (client) => {
        const currentResult = await client.query("SELECT * FROM agents WHERE id = $1 FOR UPDATE", [agentId]);
        const current = currentResult.rows[0];
        if (!current) throw domainError("AGENT_NOT_FOUND", "账号不存在", 404);
        let updated;
        try {
          updated = await client.query(`UPDATE agents SET account = $2, display_name = $3, wechat = $4, phone = $5,
            password_hash = COALESCE($6, password_hash), must_change_password = CASE WHEN $6 IS NULL THEN must_change_password ELSE FALSE END,
            updated_at = now() WHERE id = $1 RETURNING id, account, display_name, wechat, phone, password_hash, role, active, must_change_password`,
            [agentId, input.account, input.name, input.wechat || null, input.phone || null, input.passwordHash || null]);
        } catch (error) {
          if (error.code === "23505") throw domainError("AGENT_LOGIN_DUPLICATE", "账号、手机号或微信已被使用", 409);
          throw error;
        }
        if (current.display_name !== input.name || (current.wechat || "") !== (input.wechat || "")) {
          await client.query(`INSERT INTO agent_profile_history
            (agent_id, old_display_name, new_display_name, old_wechat, new_wechat, changed_by)
            VALUES ($1,$2,$3,$4,$5,$1)`, [agentId, current.display_name, input.name, current.wechat, input.wechat || null]);
        }
        if (input.passwordHash) {
          await client.query("DELETE FROM sessions WHERE agent_id = $1 AND id <> $2", [agentId, input.currentSessionDigest]);
        }
        return mapAgent(updated.rows[0]);
      });
    },
    async createAgent(input, admin) {
      return transaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('tutor-agent-account'))");
        const accountResult = await client.query(`SELECT lpad((COALESCE(MAX(account::int), 0) + 1)::text, 3, '0') AS account
          FROM agents WHERE account ~ '^[0-9]+$'`);
        const account = accountResult.rows[0].account;
        let inserted;
        try {
          inserted = await client.query(`INSERT INTO agents
            (account, display_name, wechat, phone, password_hash, role, active, must_change_password)
            VALUES ($1,$2,$3,$4,$5,'staff',TRUE,TRUE)
            RETURNING id, account, display_name, wechat, phone, password_hash, role, active, must_change_password`,
            [account, input.name, input.wechat || null, input.phone || null, input.passwordHash]);
        } catch (error) {
          if (error.code === "23505") throw domainError("AGENT_LOGIN_DUPLICATE", "手机号或微信已被使用", 409);
          throw error;
        }
        await client.query(`INSERT INTO agent_profile_history
          (agent_id, new_display_name, new_wechat, changed_by) VALUES ($1,$2,$3,$4)`,
          [inserted.rows[0].id, input.name, input.wechat || null, admin.id]);
        return mapAgent(inserted.rows[0]);
      });
    },
    async resetAgentPassword(agentId, passwordHash) {
      await transaction(pool, async (client) => {
        const result = await client.query(`UPDATE agents SET password_hash = $2, must_change_password = TRUE, updated_at = now()
          WHERE id = $1 AND role = 'staff' RETURNING id`, [agentId, passwordHash]);
        if (!result.rows[0]) throw domainError("AGENT_NOT_FOUND", "中介账号不存在", 404);
        await client.query("DELETE FROM sessions WHERE agent_id = $1", [agentId]);
      });
    },
    async createImportBatch({ sourceType, filename, items }, actor) {
      if (!Array.isArray(items) || !items.length) throw domainError("IMPORT_EMPTY", "没有可导入的数据", 400);
      if (items.length > 5000) throw domainError("IMPORT_TOO_MANY_ROWS", "单批最多导入5000条", 400);
      const batchResult = await query(`INSERT INTO import_batches
        (source_type, original_filename, created_by, total_count, status)
        VALUES ($1, $2, $3, $4, 'processing') RETURNING *`,
        [sourceType, filename || null, actor.id, items.length]);
      const batch = batchResult.rows[0];
      let readyCount = 0;
      let needsReviewCount = 0;
      let processedCount = 0;
      const staged = [];
      let duplicateIndex = createImportDuplicateIndex();
      try {
        for (const group of chunks(items, 200)) {
          const groupResult = await transaction(pool, async (client) => {
            const databaseWarnings = await databaseDuplicateWarningsForItems(client, group);
            const nextDuplicateIndex = cloneImportDuplicateIndex(duplicateIndex);
            let groupReadyCount = 0;
            let groupNeedsReviewCount = 0;
            const prepared = group.map((item) => {
              const parsedData = item.parsedData || {};
              const validation = validateImportItem(parsedData, item.fieldConfidence);
              const duplicates = [
                ...(databaseWarnings.get(Number(item.rowNumber)) || []),
                ...duplicateWarningsFromIndex(parsedData, nextDuplicateIndex)
              ];
              const warnings = [...new Set([...(item.warnings || []), ...validation.warnings, ...duplicates])];
              const reviewStatus = validation.warnings.length || duplicates.length ? "needs_review" : "ready";
              if (reviewStatus === "ready") groupReadyCount += 1;
              else groupNeedsReviewCount += 1;
              addImportToDuplicateIndex(nextDuplicateIndex, parsedData);
              return { ...item, warnings, reviewStatus, errorCategory: classifyImportError(warnings) };
            });
            const rows = await insertImportItems(client, batch.id, prepared);
            const lastRow = Math.max(...group.map((item) => Number(item.rowNumber || 0)));
            await client.query(`UPDATE import_batches SET ready_count = $2, needs_review_count = $3,
              processed_count = $4, last_processed_row = $5, updated_at = now() WHERE id = $1`,
              [batch.id, readyCount + groupReadyCount, needsReviewCount + groupNeedsReviewCount,
                processedCount + group.length, lastRow]);
            return { rows, nextDuplicateIndex, groupReadyCount, groupNeedsReviewCount, groupItemCount: group.length };
          });
          readyCount += groupResult.groupReadyCount;
          needsReviewCount += groupResult.groupNeedsReviewCount;
          processedCount += groupResult.groupItemCount;
          duplicateIndex = groupResult.nextDuplicateIndex;
          staged.push(...groupResult.rows);
        }
        await query("UPDATE import_batches SET status = 'reviewing', updated_at = now() WHERE id = $1", [batch.id]);
      } catch (error) {
        await query(`UPDATE import_batches SET status = 'failed', failed_count = total_count - processed_count,
          error_message = $2, updated_at = now() WHERE id = $1`, [batch.id, String(error.message || "导入失败").slice(0, 500)]).catch(() => {});
        throw error;
      }
      return { id: batch.id, sourceType, filename: filename || "", totalCount: items.length, readyCount, needsReviewCount, items: staged };
    },
    async resumeImportBatch(batchId, items, actor) {
      if (!Array.isArray(items) || !items.length) throw domainError("IMPORT_EMPTY", "No import data was supplied", 400);
      if (items.length > 5000) throw domainError("IMPORT_TOO_MANY_ROWS", "A batch can contain at most 5000 rows", 400);
      const batchResult = await query(`SELECT id, source_type, original_filename, created_by, total_count,
        ready_count, needs_review_count, processed_count, last_processed_row, status
        FROM import_batches WHERE id = $1`, [batchId]);
      const batch = batchResult.rows[0];
      if (!batch) throw domainError("IMPORT_BATCH_NOT_FOUND", "Import batch not found", 404);
      if (String(batch.created_by) !== String(actor.id) && actor.role !== "admin") {
        throw domainError("IMPORT_BATCH_FORBIDDEN", "Only the batch owner or an administrator can resume it", 403);
      }
      if (batch.status === "completed") throw domainError("IMPORT_BATCH_COMPLETE", "Completed batches cannot be resumed", 409);

      const existingResult = await query(`SELECT row_number, parsed_data FROM import_items
        WHERE batch_id = $1 ORDER BY row_number`, [batchId]);
      const existingRows = existingResult.rows.map((row) => Number(row.row_number));
      const pending = pendingImportItems(items, batch.last_processed_row, existingRows);
      const priorItems = existingResult.rows.map((row) => ({ ...(row.parsed_data || {}), status: "active" }));
      let duplicateIndex = createImportDuplicateIndex(priorItems);
      let readyCount = Number(batch.ready_count || 0);
      let needsReviewCount = Number(batch.needs_review_count || 0);
      let processedCount = Number(batch.processed_count || existingRows.length);
      const staged = [];
      await query(`UPDATE import_batches SET status = 'processing', total_count = GREATEST(total_count, $2),
        failed_count = 0, error_message = NULL, updated_at = now() WHERE id = $1`, [batchId, items.length]);
      try {
        for (const group of chunks(pending, 200)) {
          const groupResult = await transaction(pool, async (client) => {
            const databaseWarnings = await databaseDuplicateWarningsForItems(client, group);
            const nextDuplicateIndex = cloneImportDuplicateIndex(duplicateIndex);
            let groupReadyCount = 0;
            let groupNeedsReviewCount = 0;
            const prepared = group.map((item) => {
              const parsedData = item.parsedData || {};
              const validation = validateImportItem(parsedData, item.fieldConfidence);
              const duplicates = [
                ...(databaseWarnings.get(Number(item.rowNumber)) || []),
                ...duplicateWarningsFromIndex(parsedData, nextDuplicateIndex)
              ];
              const warnings = [...new Set([...(item.warnings || []), ...validation.warnings, ...duplicates])];
              const reviewStatus = validation.warnings.length || duplicates.length ? "needs_review" : "ready";
              if (reviewStatus === "ready") groupReadyCount += 1;
              else groupNeedsReviewCount += 1;
              addImportToDuplicateIndex(nextDuplicateIndex, parsedData);
              return { ...item, warnings, reviewStatus, errorCategory: classifyImportError(warnings) };
            });
            const rows = await insertImportItems(client, batchId, prepared);
            const lastRow = Math.max(...group.map((item) => Number(item.rowNumber || 0)));
            await client.query(`UPDATE import_batches SET ready_count = $2, needs_review_count = $3,
              processed_count = $4, last_processed_row = $5, updated_at = now() WHERE id = $1`,
              [batchId, readyCount + groupReadyCount, needsReviewCount + groupNeedsReviewCount,
                processedCount + group.length, lastRow]);
            return { rows, nextDuplicateIndex, groupReadyCount, groupNeedsReviewCount, groupItemCount: group.length };
          });
          readyCount += groupResult.groupReadyCount;
          needsReviewCount += groupResult.groupNeedsReviewCount;
          processedCount += groupResult.groupItemCount;
          duplicateIndex = groupResult.nextDuplicateIndex;
          staged.push(...groupResult.rows);
        }
        await query("UPDATE import_batches SET status = 'reviewing', updated_at = now() WHERE id = $1", [batchId]);
      } catch (error) {
        await query(`UPDATE import_batches SET status = 'failed', failed_count = total_count - processed_count,
          error_message = $2, updated_at = now() WHERE id = $1`, [batchId, String(error.message || "Import failed").slice(0, 500)]).catch(() => {});
        throw error;
      }
      return {
        id: batchId, sourceType: batch.source_type, filename: batch.original_filename || "",
        totalCount: Math.max(Number(batch.total_count || 0), items.length), processedCount,
        readyCount, needsReviewCount, resumedCount: staged.length, items: staged
      };
    },
    async listImportBatches() {
      const result = await query(`SELECT id, source_type, original_filename, total_count, ready_count,
        needs_review_count, published_count, status, processed_count, failed_count, last_processed_row,
        error_message, created_at, updated_at FROM import_batches ORDER BY created_at DESC LIMIT 20`);
      return result.rows.map((row) => ({
        id: row.id, sourceType: row.source_type, filename: row.original_filename || "", totalCount: row.total_count,
        readyCount: row.ready_count, needsReviewCount: row.needs_review_count, publishedCount: row.published_count,
        status: row.status, processedCount: row.processed_count, failedCount: row.failed_count,
        lastProcessedRow: row.last_processed_row, errorMessage: row.error_message || "",
        createdAt: row.created_at, updatedAt: row.updated_at
      }));
    },
    async listImportErrors(batchId) {
      const result = await query(`SELECT row_number, parsed_data, warnings FROM import_items
        WHERE batch_id = $1 AND review_status = 'needs_review' ORDER BY row_number`, [batchId]);
      return result.rows.map((row) => ({ rowNumber: row.row_number, parsedData: row.parsed_data || {}, warnings: row.warnings || [] }));
    },
    async getImportBatch(batchId, options = {}) {
      if (typeof options !== "object") options = { page: options };
      const currentPage = normalizePage(options.page);
      const values = [batchId];
      const where = ["ii.batch_id = $1"];
      if (["ready", "needs_review", "published"].includes(options.reviewStatus)) {
        values.push(options.reviewStatus);
        where.push(`ii.review_status = $${values.length}`);
      }
      if (String(options.keyword || "").trim()) {
        values.push(`%${String(options.keyword).trim()}%`);
        const p = `$${values.length}`;
        where.push(`(ii.raw_text ILIKE ${p} OR ii.parsed_data->>'orderNo' ILIKE ${p}
          OR ii.parsed_data->>'address' ILIKE ${p} OR ii.parsed_data->>'grade' ILIKE ${p}
          OR ii.parsed_data->>'subject' ILIKE ${p})`);
      }
      values.push((currentPage - 1) * 10);
      const [result, batchResult] = await Promise.all([
        query(`SELECT ii.*, count(*) OVER() AS total_count FROM import_items ii
          WHERE ${where.join(" AND ")} ORDER BY ii.row_number LIMIT 10 OFFSET $${values.length}`, values),
        query(`SELECT id, status, total_count, processed_count, ready_count, needs_review_count,
          published_count, failed_count, last_processed_row, error_message, updated_at
          FROM import_batches WHERE id = $1`, [batchId])
      ]);
      const totalItems = Number(result.rows[0]?.total_count || 0);
      const batch = batchResult.rows[0];
      return {
        batch: batch ? {
          id: batch.id, status: batch.status, totalCount: batch.total_count, processedCount: batch.processed_count,
          readyCount: batch.ready_count, needsReviewCount: batch.needs_review_count,
          publishedCount: batch.published_count, failedCount: batch.failed_count,
          lastProcessedRow: batch.last_processed_row, errorMessage: batch.error_message || "", updatedAt: batch.updated_at
        } : null,
        items: result.rows.map(mapImportItem), page: currentPage, pageSize: 10,
        totalItems, totalPages: Math.max(1, Math.ceil(totalItems / 10))
      };
    },
    async updateImportItem(itemId, input, actor) {
      return transaction(pool, async (client) => {
        const currentResult = await client.query("SELECT * FROM import_items WHERE id = $1 FOR UPDATE", [itemId]);
        const current = currentResult.rows[0];
        if (!current) throw domainError("IMPORT_ITEM_NOT_FOUND", "导入记录不存在", 404);
        if (current.review_status === "published") throw domainError("IMPORT_ITEM_READ_ONLY", "已发布记录不能修改", 409);
        if (Number(input.version) !== Number(current.version)) throw domainError("IMPORT_VERSION_CONFLICT", "记录已被更新，请刷新后重试", 409);
        const parsedData = { ...(current.parsed_data || {}), ...(input.parsedData || {}) };
        const fieldConfidence = { ...(current.field_confidence || {}) };
        const fieldSources = { ...(current.field_sources || {}) };
        for (const field of Object.keys(input.parsedData || {})) {
          fieldConfidence[field] = String(input.parsedData[field] ?? "").trim() ? "high" : "low";
          fieldSources[field] = { method: "manual-review", agentId: actor?.id || null };
        }
        const validation = validateImportItem(parsedData, fieldConfidence);
        const duplicates = await databaseDuplicateWarnings(client, parsedData);
        const duplicateConfirmed = input.duplicateConfirmed === true;
        const warnings = [...new Set([...validation.warnings, ...duplicates])];
        const reviewStatus = validation.warnings.length || (duplicates.length && !duplicateConfirmed) ? "needs_review" : "ready";
        const updated = await client.query(`UPDATE import_items SET parsed_data = $2, warnings = $3, review_status = $4,
          duplicate_confirmed = $5, field_confidence = $6, field_sources = $7, error_category = $8,
          version = version + 1, updated_at = now() WHERE id = $1 AND version = $9 RETURNING *`,
          [itemId, parsedData, JSON.stringify(warnings), reviewStatus, duplicateConfirmed, fieldConfidence, fieldSources,
            classifyImportError(warnings), Number(current.version)]);
        if (!updated.rows[0]) throw domainError("IMPORT_VERSION_CONFLICT", "记录已被更新，请刷新后重试", 409);
        return mapImportItem(updated.rows[0]);
      });
    },
    async publishImportBatch(batchId, options = {}, actor) {
      if (!actor && options?.id) {
        actor = options;
        options = {};
      }
      assertPublishingActor(actor);
      const selectedIds = options.mode === "selected" ? (options.itemIds || []).slice(0, 50) : null;
      return transaction(pool, async (client) => {
        await client.query("UPDATE import_batches SET status = 'publishing', updated_at = now() WHERE id = $1", [batchId]);
        const result = await client.query(`SELECT * FROM import_items
          WHERE batch_id = $1 AND review_status = 'ready'
            AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
          ORDER BY row_number LIMIT 50 FOR UPDATE SKIP LOCKED`, [batchId, selectedIds]);
        const ready = result.rows;
        let publishedCount = 0;
        let duplicateCount = 0;
        for (const item of ready) {
          const data = item.parsed_data || {};
          const freshDuplicates = await databaseDuplicateWarnings(client, data, null, batchId);
          if (freshDuplicates.length && !item.duplicate_confirmed) {
            const warnings = [...new Set([...(item.warnings || []), ...freshDuplicates])];
            await client.query(`UPDATE import_items SET warnings = $2, review_status = 'needs_review',
              error_category = 'duplicate', version = version + 1, updated_at = now() WHERE id = $1`, [item.id, JSON.stringify(warnings)]);
            duplicateCount += 1;
            continue;
          }
          const requestedOrderNo = assertManualOrderNoAllowed(data.orderNo);
          const orderNo = requestedOrderNo || await allocateOrderNo(client);
          let inserted;
          try {
            inserted = await client.query(`INSERT INTO orders (
              order_no, student_gender, grade, subject, score, lesson_time, start_time_text,
              lesson_frequency, lesson_duration, price, area, rough_address, address, teacher_requirement,
              teacher_gender_requirement, teacher_education_requirement, parent_name, parent_phone,
              parent_wechat, internal_note, raw_text, agent_id, status, review_status, published_at,
              idempotency_key, import_batch_id
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
              'active','published',now(),$23,$24)
            RETURNING id`, [
              orderNo, data.studentGender || null, data.grade, data.subject, data.score, data.lessonTime,
              data.startTimeText || null, data.lessonFrequency || null, data.lessonDuration || null, data.price,
              data.area, data.roughAddress, data.address, data.requirement || null, data.teacherGenderRequirement || null,
              data.teacherEducationRequirement || null, data.parentName || null, data.parentPhone || null,
              data.parentWechat || null, data.internalNote || null, data.rawText || item.raw_text || null,
              actor.id, `import:${item.id}`, batchId
            ]);
          } catch (error) {
            if (error.code === "23505") throw domainError("IMPORT_DUPLICATE_ORDER", `第${item.row_number}行订单号已存在，请修改后重试`, 409);
            throw error;
          }
          await client.query(`UPDATE import_items SET review_status = 'published', published_order_id = $2,
            published_at = now(), version = version + 1, updated_at = now() WHERE id = $1`, [item.id, inserted.rows[0].id]);
          await client.query(`INSERT INTO order_logs (order_id, actor_agent_id, actor_name_snapshot, action, reason, to_status)
            VALUES ($1, $2, $3, '导入发布', '审核通过后发布', 'active')`, [inserted.rows[0].id, actor.id, actor.name]);
          publishedCount += 1;
        }
        await client.query(`UPDATE import_batches SET published_count = published_count + $2,
          ready_count = GREATEST(ready_count - $2 - $3, 0),
          needs_review_count = needs_review_count + $3, updated_at = now() WHERE id = $1`,
          [batchId, publishedCount, duplicateCount]);
        const remaining = await client.query(`SELECT
          count(*) FILTER (WHERE review_status = 'ready')::int AS ready_count,
          count(*) FILTER (WHERE review_status = 'needs_review')::int AS needs_review_count
          FROM import_items WHERE batch_id = $1`, [batchId]);
        const remainingCount = Number(remaining.rows[0]?.ready_count || 0);
        const needsReviewCount = Number(remaining.rows[0]?.needs_review_count || 0);
        await client.query(`UPDATE import_batches SET status = $2, updated_at = now() WHERE id = $1`,
          [batchId, remainingCount || needsReviewCount ? "reviewing" : "completed"]);
        return {
          publishedCount,
          skippedCount: selectedIds ? Math.max(0, selectedIds.length - publishedCount) : needsReviewCount,
          remainingCount
        };
      });
    },
    async createOrder(input, actor) {
      assertPublishingActor(actor);
      return transaction(pool, async (client) => {
        if (input.idempotencyKey) {
          const existing = await client.query("SELECT o.* FROM orders o WHERE o.idempotency_key = $1 LIMIT 1", [input.idempotencyKey]);
          if (existing.rows[0]) return mapOrder(existing.rows[0]);
        }
        assertRequiredOrderFields(input);
        const duplicateWarnings = await databaseDuplicateWarnings(client, input);
        if (duplicateWarnings.length && input.duplicateConfirmed !== true) {
          throw domainError("ORDER_DUPLICATE_SUSPECTED", `发现疑似重复：${duplicateWarnings.join("、")}`, 409);
        }
        let orderNo = assertManualOrderNoAllowed(input.orderNo);
        if (!orderNo) {
          orderNo = await allocateOrderNo(client);
        }
        let inserted;
        try {
          inserted = await client.query(`INSERT INTO orders (
            order_no, student_gender, grade, subject, score, lesson_time, start_time_text,
            lesson_frequency, lesson_duration, price, area, rough_address, address, teacher_requirement,
            teacher_gender_requirement, teacher_education_requirement, parent_name, parent_phone,
            parent_wechat, internal_note, raw_text, agent_id, status, review_status, published_at, idempotency_key
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
            'active','published',now(),$23)
          ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
          RETURNING *`, [
            orderNo, input.studentGender || null, input.grade.trim(), input.subject.trim(), input.score.trim(), input.lessonTime.trim(),
            input.startTimeText || null, input.lessonFrequency || null, input.lessonDuration || null, input.price.trim(),
            input.area.trim(), input.roughAddress.trim(), input.address.trim(), input.requirement || null, input.teacherGenderRequirement || null,
            input.teacherEducationRequirement || null, input.parentName || null, input.parentPhone || null,
            input.parentWechat || null, input.internalNote || null, input.rawText || null,
            input.agentId || actor.id, input.idempotencyKey || null
          ]);
        } catch (error) {
          if (error.code === "23505") throw domainError("ORDER_DUPLICATE", "订单号或发布请求已存在", 409);
          throw error;
        }
        if (!inserted.rows[0] && input.idempotencyKey) {
          const existing = await client.query("SELECT o.* FROM orders o WHERE o.idempotency_key = $1 LIMIT 1", [input.idempotencyKey]);
          if (existing.rows[0]) return mapOrder(existing.rows[0]);
          throw domainError("ORDER_IDEMPOTENCY_CONFLICT", "发布请求正在处理中，请刷新后查看", 409);
        }
        const order = inserted.rows[0];
        await client.query(`INSERT INTO order_logs (order_id, actor_agent_id, actor_name_snapshot, action, reason, to_status)
          VALUES ($1, $2, $3, '发布订单', '订单进入老师大厅', 'active')`, [order.id, actor.id, actor.name]);
        return mapOrder(order);
      });
    },
    async updateOrder(orderId, input, actor) {
      return transaction(pool, async (client) => {
        const currentResult = await client.query("SELECT o.* FROM orders o WHERE o.id = $1 FOR UPDATE", [orderId]);
        const current = currentResult.rows[0];
        if (!current) throw domainError("ORDER_NOT_FOUND", "订单不存在", 404);
        if (Number(input.version) !== Number(current.version)) throw domainError("ORDER_VERSION_CONFLICT", "订单已被其他人更新，请刷新后重试", 409);
        if (!ACTIVE_STATUSES.includes(current.status)) throw domainError("ORDER_READ_ONLY", "历史订单只读，不能编辑", 409);
        if (Object.hasOwn(input, "orderNo")) {
          const orderNo = assertManualOrderNoAllowed(input.orderNo, current.order_no);
          if (!orderNo) throw domainError("ORDER_NO_REQUIRED", "订单号不能为空", 400);
          input = { ...input, orderNo };
        }
        const columnMap = {
          orderNo: "order_no", studentGender: "student_gender", grade: "grade", subject: "subject", score: "score",
          lessonTime: "lesson_time", startTimeText: "start_time_text", lessonFrequency: "lesson_frequency",
          lessonDuration: "lesson_duration", price: "price", area: "area", roughAddress: "rough_address", address: "address", requirement: "teacher_requirement",
          teacherGenderRequirement: "teacher_gender_requirement", teacherEducationRequirement: "teacher_education_requirement",
          parentName: "parent_name", parentPhone: "parent_phone", parentWechat: "parent_wechat", internalNote: "internal_note",
          rawText: "raw_text", agentId: "agent_id"
        };
        const entries = Object.entries(columnMap).filter(([key]) => Object.hasOwn(input, key));
        if (!entries.length) return mapOrder(current);
        assertRequiredOrderFields({
          grade: input.grade ?? current.grade, subject: input.subject ?? current.subject, area: input.area ?? current.area,
          score: input.score ?? current.score, lessonTime: input.lessonTime ?? current.lesson_time,
          price: input.price ?? current.price, roughAddress: input.roughAddress ?? current.rough_address,
          address: input.address ?? current.address, parentWechat: input.parentWechat ?? current.parent_wechat
        });
        const values = entries.map(([key]) => input[key] === "" ? null : input[key]);
        const assignments = entries.map(([, column], index) => `${column} = $${index + 2}`);
        values.push(Number(current.version));
        let updated;
        try {
          updated = await client.query(`UPDATE orders SET ${assignments.join(", ")}, version = version + 1, updated_at = now()
            WHERE id = $1 AND version = $${values.length + 1} RETURNING *`, [orderId, ...values]);
        } catch (error) {
          if (error.code === "23505") throw domainError("ORDER_DUPLICATE", "订单号已存在，请使用其他编号", 409);
          throw error;
        }
        if (!updated.rows[0]) throw domainError("ORDER_VERSION_CONFLICT", "订单已被其他人更新，请刷新后重试", 409);
        const changes = Object.fromEntries(entries.map(([key, column], index) => [key,
          SENSITIVE_AUDIT_FIELDS.has(key) ? { changed: current[column] !== values[index] } : { from: current[column], to: values[index] }
        ]));
        await client.query(`INSERT INTO order_logs (order_id, actor_agent_id, actor_name_snapshot, action, reason, from_status, to_status, changes)
          VALUES ($1, $2, $3, '编辑订单', $4, $5, $5, $6)`, [orderId, actor.id, actor.name,
          String(input.reason || "").trim() || "更新订单资料", current.status, changes]);
        return mapOrder(updated.rows[0]);
      });
    },
    async transitionOrder(orderId, input, actor) {
      if (!String(input.reason || "").trim()) throw domainError("REASON_REQUIRED", "请填写操作原因", 400);
      if (input.status === "paused" && !String(input.assignedTeacherContact || "").trim()) {
        throw domainError("TEACHER_CONTACT_REQUIRED", "锁单沟通必须填写接单老师联系方式", 400);
      }
      return transaction(pool, async (client) => {
        const currentResult = await client.query("SELECT o.* FROM orders o WHERE o.id = $1 FOR UPDATE", [orderId]);
        const current = currentResult.rows[0];
        if (!current) throw domainError("ORDER_NOT_FOUND", "订单不存在", 404);
        if (Number(input.version) !== Number(current.version)) throw domainError("ORDER_VERSION_CONFLICT", "订单已被其他人更新，请刷新后重试", 409);
        assertTransition(current.status, input.status);
        const closedAt = HISTORY_STATUSES.includes(input.status) ? new Date() : null;
        const contact = input.status === "paused" ? String(input.assignedTeacherContact).trim() : (input.status === "active" ? null : current.assigned_teacher_contact);
        const closeReason = HISTORY_STATUSES.includes(input.status) ? String(input.reason).trim() : null;
        const lockMetadata = input.status === "paused"
          ? { agentId: actor.id, lockedAt: new Date(), followUpAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }
          : { agentId: null, lockedAt: null, followUpAt: null };
        const updated = await client.query(`UPDATE orders SET status = $2, assigned_teacher_contact = $3, closed_at = $4,
          close_reason = $5, locked_by_agent_id = $6, locked_at = $7, lock_follow_up_at = $8,
          version = version + 1, updated_at = now() WHERE id = $1 AND version = $9 RETURNING *`,
          [orderId, input.status, contact, closedAt, closeReason, lockMetadata.agentId, lockMetadata.lockedAt,
            lockMetadata.followUpAt, Number(current.version)]);
        if (!updated.rows[0]) throw domainError("ORDER_VERSION_CONFLICT", "订单已被其他人更新，请刷新后重试", 409);
        await client.query(`INSERT INTO order_logs (order_id, actor_agent_id, actor_name_snapshot, action, reason, from_status, to_status, changes)
          VALUES ($1, $2, $3, '状态变更', $4, $5, $6, $7)`, [orderId, actor.id, actor.name, String(input.reason).trim(), current.status, input.status,
            { status: { from: current.status, to: input.status }, assignedTeacherContact: { changed: (current.assigned_teacher_contact || null) !== contact } }]);
        return mapOrder(updated.rows[0]);
      });
    },
    async correctOrder(orderId, input, actor) {
      if (!String(input.reason || "").trim()) throw domainError("REASON_REQUIRED", "管理员纠错必须填写原因", 400);
      const allowed = [...ACTIVE_STATUSES, ...HISTORY_STATUSES];
      if (!allowed.includes(input.status)) throw domainError("ORDER_STATUS_INVALID", "纠错目标状态无效", 400);
      return transaction(pool, async (client) => {
        const currentResult = await client.query("SELECT o.* FROM orders o WHERE o.id = $1 FOR UPDATE", [orderId]);
        const current = currentResult.rows[0];
        if (!current) throw domainError("ORDER_NOT_FOUND", "订单不存在", 404);
        if (Number(input.version) !== Number(current.version)) throw domainError("ORDER_VERSION_CONFLICT", "订单已被其他人更新，请刷新后重试", 409);
        const closedAt = HISTORY_STATUSES.includes(input.status) ? (current.closed_at || new Date()) : null;
        const closeReason = HISTORY_STATUSES.includes(input.status) ? String(input.reason).trim() : null;
        const contact = input.status === "paused" ? String(input.assignedTeacherContact || current.assigned_teacher_contact || "").trim() : current.assigned_teacher_contact;
        if (input.status === "paused" && !contact) throw domainError("TEACHER_CONTACT_REQUIRED", "锁单状态必须填写老师联系方式", 400);
        const updated = await client.query(`UPDATE orders SET status = $2, assigned_teacher_contact = $3, closed_at = $4,
          close_reason = $5, version = version + 1, updated_at = now() WHERE id = $1 AND version = $6 RETURNING *`,
          [orderId, input.status, contact || null, closedAt, closeReason, Number(current.version)]);
        if (!updated.rows[0]) throw domainError("ORDER_VERSION_CONFLICT", "订单已被其他人更新，请刷新后重试", 409);
        await client.query(`INSERT INTO order_logs
          (order_id, actor_agent_id, actor_name_snapshot, action, reason, from_status, to_status, changes)
          VALUES ($1,$2,$3,'管理员特殊纠错',$4,$5,$6,$7)`, [orderId, actor.id, actor.name, String(input.reason).trim(),
          current.status, input.status, { status: { from: current.status, to: input.status } }]);
        return mapOrder(updated.rows[0]);
      });
    },
    async close() {
      await pool.end?.();
    }
  };
}

module.exports = {
  PAGE_SIZE, addImportToDuplicateIndex, allocateOrderNo, assertManualOrderNoAllowed, assertPublishingActor, assertRequiredOrderFields, buildAgentOrderQuery,
  buildTeacherOrderQuery, createImportDuplicateIndex, createRepository, databaseDuplicateWarnings,
  duplicateWarningsFromIndex, mapAgent, mapImportItem, mapOrder, normalizePage,
  pendingImportItems, placeholders
};
