const test = require("node:test");
const assert = require("node:assert/strict");

const { createRepository } = require("../src/repository.js");

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
