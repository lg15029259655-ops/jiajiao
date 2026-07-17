const test = require("node:test");
const assert = require("node:assert/strict");

const { createRepository } = require("../src/repository.js");

test("resume filtering skips rows already processed or already staged", () => {
  const { pendingImportItems } = require("../src/repository.js");
  const items = [1, 2, 3, 4, 5].map((rowNumber) => ({ rowNumber }));
  assert.deepEqual(
    pendingImportItems(items, 2, [4]).map((item) => item.rowNumber),
    [3, 5]
  );
});

test("batch duplicate lookup uses reusable indexes", () => {
  const { addImportToDuplicateIndex, createImportDuplicateIndex, duplicateWarningsFromIndex } = require("../src/repository.js");
  const index = createImportDuplicateIndex();
  addImportToDuplicateIndex(index, {
    orderNo: "001426", parentPhone: "13900000000", address: "小寨", grade: "初二", subject: "数学", rawText: "原始订单"
  });
  assert.ok(duplicateWarningsFromIndex({ orderNo: "001426" }, index).length > 0);
  assert.ok(duplicateWarningsFromIndex({ parentPhone: "13900000000" }, index).length > 0);
  assert.ok(duplicateWarningsFromIndex({ address: "小寨", grade: "初二", subject: "数学" }, index).length > 0);
  assert.ok(duplicateWarningsFromIndex({ rawText: "原始订单" }, index).length > 0);
});

test("agent query exposes lock and stale reminders without changing order status", () => {
  const { buildAgentOrderQuery } = require("../src/repository.js");
  const statement = buildAgentOrderQuery({ scope: "working", followup: "lockOverdue", page: 1 });
  assert.match(statement.text, /lock_follow_up_at <= now\(\)/);
  assert.doesNotMatch(statement.text, /UPDATE orders/);
});

test("mapped orders include structured lesson fields and reminder levels", async () => {
  const pool = {
    async query() {
      return { rows: [{
        id: "o1", order_no: "001426", status: "paused", grade: "初二", subject: "数学",
        start_time_text: "7月中旬", lesson_frequency: "每周2次", lesson_duration: "2h",
        teacher_gender_requirement: "女", teacher_education_requirement: "大学生",
        lock_follow_up_at: new Date(Date.now() - 1000), total_count: "1"
      }] };
    }
  };
  const result = await createRepository(pool).listTeacherOrders({ page: 1 });
  assert.equal(result.items[0].startTimeText, "7月中旬");
  assert.equal(result.items[0].lessonFrequency, "每周2次");
});

test("repository maps paginated teacher rows without loading the full database", async () => {
  const calls = [];
  const pool = {
    async query(text, values) {
      calls.push({ text, values });
      return { rows: [{ id: "o1", order_no: "071601", status: "active", grade: "初二", subject: "数学", area: "雁塔区", address: "公开地址", agent_name: "中介A", agent_wechat: "agent001", total_count: "21" }] };
    }
  };
  const repository = createRepository(pool);
  const result = await repository.listTeacherOrders({ page: 2 });
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /LIMIT 10 OFFSET/);
  assert.equal(result.items[0].orderNo, "071601");
  assert.equal(result.totalItems, 21);
  assert.equal(result.totalPages, 3);
});

test("repository stores and resolves database sessions by digest", async () => {
  const calls = [];
  const pool = {
    async query(text, values) {
      calls.push({ text, values });
      if (/SELECT a\./.test(text)) return { rows: [{ id: "a1", account: "001", display_name: "中介A", password_hash: "hash", role: "staff", active: true, must_change_password: false }] };
      return { rows: [] };
    }
  };
  const repository = createRepository(pool);
  await repository.createSession({ digest: "digest", agentId: "a1", expiresAt: new Date(), userAgent: "test", ip: "127.0.0.1" });
  const agent = await repository.getSessionAgent("digest");
  assert.match(calls[0].text, /INSERT INTO sessions/);
  assert.match(calls[1].text, /expires_at > now\(\)/);
  assert.match(calls[1].text, /last_seen_at = now\(\)/);
  assert.equal(agent.account, "001");
});
