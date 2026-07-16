const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ACTIVE_STATUSES,
  HISTORY_STATUSES,
  assertTransition,
  publicOrder,
  shouldAnonymize
} = require("../src/domain.js");
const { hashPassword, verifyPassword, needsPasswordUpgrade } = require("../src/security.js");
const { transaction, withTransientRetry } = require("../src/database.js");

test("status model has no archived state", () => {
  assert.deepEqual(ACTIVE_STATUSES, ["active", "paused"]);
  assert.deepEqual(HISTORY_STATUSES, ["completed", "cancelled", "deleted"]);
});

test("only supported order transitions are allowed", () => {
  assert.doesNotThrow(() => assertTransition("active", "paused"));
  assert.doesNotThrow(() => assertTransition("paused", "completed"));
  assert.throws(() => assertTransition("completed", "active"), { code: "ORDER_STATUS_INVALID" });
  assert.throws(() => assertTransition("active", "completed"), { code: "ORDER_STATUS_INVALID" });
});

test("teacher order projection omits private fields", () => {
  const result = publicOrder({
    id: "o1",
    orderNo: "071601",
    status: "active",
    grade: "初二",
    subject: "数学",
    area: "雁塔区",
    address: "公开地址",
    parentPhone: "13900000000",
    parentWechat: "private",
    rawText: "private raw text",
    internalNote: "private note"
  });
  assert.equal(result.orderNo, "071601");
  assert.equal(result.parentPhone, undefined);
  assert.equal(result.parentWechat, undefined);
  assert.equal(result.rawText, undefined);
  assert.equal(result.internalNote, undefined);
});

test("terminal orders become eligible for anonymization after six months", () => {
  const now = new Date("2026-07-16T00:00:00.000Z");
  assert.equal(shouldAnonymize({ status: "completed", closedAt: "2026-01-15T00:00:00.000Z" }, now), true);
  assert.equal(shouldAnonymize({ status: "completed", closedAt: "2026-02-01T00:00:00.000Z" }, now), false);
  assert.equal(shouldAnonymize({ status: "active", closedAt: "2025-01-01T00:00:00.000Z" }, now), false);
});

test("password hashes use the current work factor and old hashes require upgrade", () => {
  const current = hashPassword("correct horse", "fixed-salt", 600000);
  const old = hashPassword("correct horse", "fixed-salt", 120000);
  assert.equal(verifyPassword("correct horse", current), true);
  assert.equal(needsPasswordUpgrade(current), false);
  assert.equal(needsPasswordUpgrade(old), true);
});

test("transient database disconnect retries exactly once", async () => {
  let attempts = 0;
  const value = await withTransientRetry(async () => {
    attempts += 1;
    if (attempts === 1) Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
    if (attempts === 1) throw Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
    return "ok";
  });
  assert.equal(value, "ok");
  assert.equal(attempts, 2);
});

test("non-transient database errors are not retried", async () => {
  let attempts = 0;
  await assert.rejects(() => withTransientRetry(async () => {
    attempts += 1;
    throw Object.assign(new Error("bad query"), { code: "42601" });
  }), /bad query/);
  assert.equal(attempts, 1);
});

test("transaction retries once when Neon disconnects before commit", async () => {
  let connections = 0;
  const pool = {
    async connect() {
      connections += 1;
      const current = connections;
      return {
        async query(text) {
          if (text === "UPDATE test" && current === 1) throw Object.assign(new Error("wake reset"), { code: "ECONNRESET" });
          return { rows: [{ ok: true }] };
        },
        release() {}
      };
    }
  };
  const result = await transaction(pool, (client) => client.query("UPDATE test"));
  assert.equal(connections, 2);
  assert.equal(result.rows[0].ok, true);
});

test("transaction never retries an ambiguous commit", async () => {
  let connections = 0;
  const pool = {
    async connect() {
      connections += 1;
      return {
        async query(text) {
          if (text === "COMMIT") throw Object.assign(new Error("commit reset"), { code: "ECONNRESET" });
          return { rows: [] };
        },
        release() {}
      };
    }
  };
  await assert.rejects(() => transaction(pool, async () => "done"), { code: "ECONNRESET" });
  assert.equal(connections, 1);
});
