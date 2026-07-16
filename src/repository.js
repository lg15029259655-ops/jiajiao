const { ACTIVE_STATUSES, HISTORY_STATUSES, assertTransition, domainError } = require("./domain.js");
const crypto = require("node:crypto");
const { transaction, withTransientRetry } = require("./database.js");
const { validateImportItem } = require("./imports.js");
const { findDuplicateWarnings: findInBatchDuplicateWarnings } = require("../platform-core.js");

const PAGE_SIZE = 10;
const SENSITIVE_AUDIT_FIELDS = new Set(["parentName", "parentPhone", "parentWechat", "internalNote", "rawText", "assignedTeacherContact"]);

function normalizePage(page) {
  const value = Number(page || 1);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function assertRequiredOrderFields(data) {
  const required = [["grade", "年级"], ["subject", "科目"], ["area", "区域"], ["score", "当前成绩"], ["lessonTime", "补习时间"], ["price", "报价"], ["address", "地址"]];
  const missing = required.filter(([key]) => !String(data[key] || "").trim()).map(([, label]) => label);
  if (missing.length) throw domainError("ORDER_FIELDS_REQUIRED", `请补全：${missing.join("、")}`, 400);
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
    where.push(`(o.order_no ILIKE ${p} OR o.address ILIKE ${p} OR o.teacher_requirement ILIKE ${p})`);
  }
  values.push((normalizePage(options.page) - 1) * PAGE_SIZE);
  return {
    text: `SELECT o.id, o.order_no, o.status, o.student_gender, o.grade, o.subject, o.score,
      o.lesson_time, o.price, o.area, o.address, o.teacher_requirement, o.created_at, o.updated_at,
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
    subject: row.subject || "", score: row.score || "", lessonTime: row.lesson_time || "", price: row.price || "",
    area: row.area || "", address: row.address || "", requirement: row.teacher_requirement || "",
    parentName: row.parent_name || "", parentPhone: row.parent_phone || "", parentWechat: row.parent_wechat || "",
    internalNote: row.internal_note || "", rawText: row.raw_text || "", assignedTeacherContact: row.assigned_teacher_contact || "",
    agentId: row.agent_id || "", agentName: row.agent_name || "中介", agentWechat: row.agent_wechat || "",
    status: row.status, version: Number(row.version || 1), createdAt: row.created_at || "", updatedAt: row.updated_at || "",
    closedAt: row.closed_at || "", anonymizedAt: row.anonymized_at || ""
  };
}

function mapImportItem(row) {
  return {
    id: row.id, batchId: row.batch_id, rowNumber: row.row_number, rawText: row.raw_text || "",
    parsedData: row.parsed_data || {}, warnings: row.warnings || [], reviewStatus: row.review_status,
    duplicateConfirmed: row.duplicate_confirmed === true, publishedOrderId: row.published_order_id || "",
    version: Number(row.version || 1), updatedAt: row.updated_at || ""
  };
}

function pageResult(rows, page) {
  const currentPage = normalizePage(page);
  const totalItems = Number(rows[0]?.total_count || 0);
  return { items: rows.map(mapOrder), page: currentPage, pageSize: PAGE_SIZE, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / PAGE_SIZE)) };
}

async function databaseDuplicateWarnings(client, data, excludeOrderId = null) {
  const values = [
    String(data.orderNo || "").trim(), String(data.parentPhone || "").trim(), String(data.parentWechat || "").trim(),
    String(data.address || "").trim(), String(data.grade || "").trim(), String(data.subject || "").trim(),
    String(data.rawText || "").trim(), excludeOrderId
  ];
  const result = await client.query(`SELECT order_no, parent_phone, parent_wechat, address, grade, subject, raw_text
    FROM orders WHERE ($8::uuid IS NULL OR id <> $8)
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

async function allocateOrderNo(client) {
  const sequence = await client.query(`INSERT INTO order_sequences(order_date, last_value) VALUES (current_date, 1)
    ON CONFLICT (order_date) DO UPDATE SET last_value = order_sequences.last_value + 1
    RETURNING to_char(order_date, 'YYMMDD') || lpad(last_value::text, 2, '0') AS order_no`);
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
      return transaction(pool, async (client) => {
        const batchResult = await client.query(`INSERT INTO import_batches
          (source_type, original_filename, created_by, total_count) VALUES ($1, $2, $3, $4) RETURNING *`,
          [sourceType, filename || null, actor.id, items.length]);
        const batch = batchResult.rows[0];
        let readyCount = 0;
        let needsReviewCount = 0;
        const staged = [];
        const priorItems = [];
        for (const item of items) {
          const parsedData = item.parsedData || {};
          const validation = validateImportItem(parsedData);
          const duplicates = [
            ...await databaseDuplicateWarnings(client, parsedData),
            ...findInBatchDuplicateWarnings({ ...parsedData, status: "active" }, priorItems)
          ];
          const warnings = [...new Set([...(item.warnings || []), ...validation.warnings, ...duplicates])];
          const reviewStatus = validation.warnings.length || duplicates.length ? "needs_review" : "ready";
          if (reviewStatus === "ready") readyCount += 1;
          else needsReviewCount += 1;
          const inserted = await client.query(`INSERT INTO import_items
            (batch_id, row_number, raw_text, parsed_data, warnings, review_status)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [batch.id, item.rowNumber, item.rawText || null, parsedData, JSON.stringify(warnings), reviewStatus]);
          staged.push(inserted.rows[0]);
          priorItems.push({ ...parsedData, status: "active" });
        }
        await client.query(`UPDATE import_batches SET ready_count = $2, needs_review_count = $3 WHERE id = $1`,
          [batch.id, readyCount, needsReviewCount]);
        return { id: batch.id, sourceType, filename: filename || "", totalCount: items.length, readyCount, needsReviewCount, items: staged };
      });
    },
    async listImportBatches() {
      const result = await query(`SELECT id, source_type, original_filename, total_count, ready_count,
        needs_review_count, published_count, created_at FROM import_batches ORDER BY created_at DESC LIMIT 20`);
      return result.rows.map((row) => ({
        id: row.id, sourceType: row.source_type, filename: row.original_filename || "", totalCount: row.total_count,
        readyCount: row.ready_count, needsReviewCount: row.needs_review_count, publishedCount: row.published_count,
        createdAt: row.created_at
      }));
    },
    async listImportErrors(batchId) {
      const result = await query(`SELECT row_number, parsed_data, warnings FROM import_items
        WHERE batch_id = $1 AND review_status = 'needs_review' ORDER BY row_number`, [batchId]);
      return result.rows.map((row) => ({ rowNumber: row.row_number, parsedData: row.parsed_data || {}, warnings: row.warnings || [] }));
    },
    async getImportBatch(batchId, page = 1) {
      const currentPage = normalizePage(page);
      const result = await query(`SELECT ii.*, count(*) OVER() AS total_count FROM import_items ii
        WHERE ii.batch_id = $1 ORDER BY ii.row_number LIMIT 10 OFFSET $2`, [batchId, (currentPage - 1) * 10]);
      const totalItems = Number(result.rows[0]?.total_count || 0);
      return { items: result.rows.map(mapImportItem), page: currentPage, pageSize: 10, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / 10)) };
    },
    async updateImportItem(itemId, input) {
      return transaction(pool, async (client) => {
        const currentResult = await client.query("SELECT * FROM import_items WHERE id = $1 FOR UPDATE", [itemId]);
        const current = currentResult.rows[0];
        if (!current) throw domainError("IMPORT_ITEM_NOT_FOUND", "导入记录不存在", 404);
        if (current.review_status === "published") throw domainError("IMPORT_ITEM_READ_ONLY", "已发布记录不能修改", 409);
        if (Number(input.version) !== Number(current.version)) throw domainError("IMPORT_VERSION_CONFLICT", "记录已被更新，请刷新后重试", 409);
        const parsedData = { ...(current.parsed_data || {}), ...(input.parsedData || {}) };
        const validation = validateImportItem(parsedData);
        const duplicates = await databaseDuplicateWarnings(client, parsedData);
        const duplicateConfirmed = input.duplicateConfirmed === true;
        const warnings = [...new Set([...validation.warnings, ...duplicates])];
        const reviewStatus = validation.warnings.length || (duplicates.length && !duplicateConfirmed) ? "needs_review" : "ready";
        const updated = await client.query(`UPDATE import_items SET parsed_data = $2, warnings = $3, review_status = $4,
          duplicate_confirmed = $5, version = version + 1, updated_at = now() WHERE id = $1 AND version = $6 RETURNING *`,
          [itemId, parsedData, JSON.stringify(warnings), reviewStatus, duplicateConfirmed, Number(current.version)]);
        if (!updated.rows[0]) throw domainError("IMPORT_VERSION_CONFLICT", "记录已被更新，请刷新后重试", 409);
        return mapImportItem(updated.rows[0]);
      });
    },
    async publishImportBatch(batchId, actor) {
      return transaction(pool, async (client) => {
        const result = await client.query(`SELECT * FROM import_items WHERE batch_id = $1 AND review_status <> 'published'
          ORDER BY row_number FOR UPDATE`, [batchId]);
        const ready = result.rows.filter((row) => row.review_status === "ready");
        let publishedCount = 0;
        for (const item of ready) {
          const data = item.parsed_data || {};
          const freshDuplicates = await databaseDuplicateWarnings(client, data);
          if (freshDuplicates.length && !item.duplicate_confirmed) {
            const warnings = [...new Set([...(item.warnings || []), ...freshDuplicates])];
            await client.query(`UPDATE import_items SET warnings = $2, review_status = 'needs_review',
              version = version + 1, updated_at = now() WHERE id = $1`, [item.id, JSON.stringify(warnings)]);
            continue;
          }
          const orderNo = String(data.orderNo || "").trim() || await allocateOrderNo(client);
          let inserted;
          try {
            inserted = await client.query(`INSERT INTO orders (
              order_no, student_gender, grade, subject, score, lesson_time, price, area, address,
              teacher_requirement, parent_name, parent_phone, parent_wechat, internal_note, raw_text,
              agent_id, status, review_status, published_at, idempotency_key, import_batch_id
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'active','published',now(),$17,$18)
            RETURNING id`, [
              orderNo, data.studentGender || null, data.grade, data.subject, data.score, data.lessonTime, data.price,
              data.area, data.address, data.requirement || null, data.parentName || null, data.parentPhone || null,
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
          ready_count = GREATEST(ready_count - $2, 0) WHERE id = $1`, [batchId, publishedCount]);
        return { publishedCount, skippedCount: result.rows.length - publishedCount };
      });
    },
    async createOrder(input, actor) {
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
        let orderNo = String(input.orderNo || "").trim();
        if (!orderNo) {
          orderNo = await allocateOrderNo(client);
        }
        let inserted;
        try {
          inserted = await client.query(`INSERT INTO orders (
            order_no, student_gender, grade, subject, score, lesson_time, price, area, address,
            teacher_requirement, parent_name, parent_phone, parent_wechat, internal_note, raw_text,
            agent_id, status, review_status, published_at, idempotency_key
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'active','published',now(),$17)
          RETURNING *`, [
            orderNo, input.studentGender || null, input.grade.trim(), input.subject.trim(), input.score.trim(), input.lessonTime.trim(),
            input.price.trim(), input.area.trim(), input.address.trim(), input.requirement || null, input.parentName || null,
            input.parentPhone || null, input.parentWechat || null, input.internalNote || null, input.rawText || null,
            input.agentId || actor.id, input.idempotencyKey || null
          ]);
        } catch (error) {
          if (error.code === "23505") throw domainError("ORDER_DUPLICATE", "订单号或发布请求已存在", 409);
          throw error;
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
        const columnMap = {
          orderNo: "order_no", studentGender: "student_gender", grade: "grade", subject: "subject", score: "score",
          lessonTime: "lesson_time", price: "price", area: "area", address: "address", requirement: "teacher_requirement",
          parentName: "parent_name", parentPhone: "parent_phone", parentWechat: "parent_wechat", internalNote: "internal_note",
          rawText: "raw_text", agentId: "agent_id"
        };
        const entries = Object.entries(columnMap).filter(([key]) => Object.hasOwn(input, key));
        if (!entries.length) return mapOrder(current);
        assertRequiredOrderFields({
          grade: input.grade ?? current.grade, subject: input.subject ?? current.subject, area: input.area ?? current.area,
          score: input.score ?? current.score, lessonTime: input.lessonTime ?? current.lesson_time,
          price: input.price ?? current.price, address: input.address ?? current.address
        });
        const values = entries.map(([key]) => input[key] === "" ? null : input[key]);
        const assignments = entries.map(([, column], index) => `${column} = $${index + 2}`);
        values.push(Number(current.version));
        const updated = await client.query(`UPDATE orders SET ${assignments.join(", ")}, version = version + 1, updated_at = now()
          WHERE id = $1 AND version = $${values.length + 1} RETURNING *`, [orderId, ...values]);
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
        const updated = await client.query(`UPDATE orders SET status = $2, assigned_teacher_contact = $3, closed_at = $4,
          close_reason = $5, version = version + 1, updated_at = now() WHERE id = $1 AND version = $6 RETURNING *`,
          [orderId, input.status, contact, closedAt, closeReason, Number(current.version)]);
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

module.exports = { PAGE_SIZE, assertRequiredOrderFields, buildAgentOrderQuery, buildTeacherOrderQuery, createRepository, databaseDuplicateWarnings, mapAgent, mapImportItem, mapOrder, normalizePage, placeholders };
