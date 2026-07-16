const test = require("node:test");
const assert = require("node:assert/strict");

const { createRepository } = require("../src/repository.js");

function transactionPool(row) {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (/SELECT o\.\*.*FOR UPDATE/s.test(text)) return { rows: [row] };
      if (/UPDATE orders/s.test(text)) return { rows: [{ ...row, status: values?.includes("paused") ? "paused" : row.status, version: row.version + 1 }] };
      return { rows: [] };
    },
    release() {}
  };
  return { calls, pool: { async connect() { return client; }, async query() { return { rows: [] }; } } };
}

test("editing with a stale order version is rejected", async () => {
  const setup = transactionPool({ id: "o1", order_no: "071601", status: "active", version: 2, grade: "初二", subject: "数学", area: "雁塔区", score: "80分", address: "地址", lesson_time: "周末", price: "100元/小时" });
  const repository = createRepository(setup.pool);
  await assert.rejects(
    () => repository.updateOrder("o1", { version: 1, grade: "初三" }, { id: "a1", name: "中介A" }),
    { code: "ORDER_VERSION_CONFLICT" }
  );
  assert.equal(setup.calls.some((call) => call.text === "ROLLBACK"), true);
});

test("pausing requires teacher contact and writes one locked transition", async () => {
  const setup = transactionPool({ id: "o1", order_no: "071601", status: "active", version: 2, grade: "初二", subject: "数学", area: "雁塔区", address: "地址", lesson_time: "周末", price: "100元/小时" });
  const repository = createRepository(setup.pool);
  await assert.rejects(
    () => repository.transitionOrder("o1", { version: 2, status: "paused", reason: "老师沟通中", assignedTeacherContact: "" }, { id: "a1", name: "中介A" }),
    { code: "TEACHER_CONTACT_REQUIRED" }
  );
  const changed = await repository.transitionOrder("o1", { version: 2, status: "paused", reason: "老师沟通中", assignedTeacherContact: "wx123" }, { id: "a1", name: "中介A" });
  assert.equal(changed.status, "paused");
  assert.equal(setup.calls.some((call) => /FOR UPDATE/.test(call.text)), true);
  assert.equal(setup.calls.some((call) => /INSERT INTO order_logs/.test(call.text)), true);
});

test("editing writes structured old and new values to the audit log", async () => {
  const setup = transactionPool({ id: "o1", order_no: "071601", status: "active", version: 2, grade: "初二", subject: "数学", area: "雁塔区", address: "地址", lesson_time: "周末", price: "100元/小时" });
  const repository = createRepository(setup.pool);
  await repository.updateOrder("o1", { version: 2, score: "80分", price: "120元/小时", reason: "家长调整报价" }, { id: "a1", name: "中介A" });
  const audit = setup.calls.find((call) => /INSERT INTO order_logs/.test(call.text));
  assert.match(audit.text, /changes/);
  assert.equal(audit.values[3], "家长调整报价");
  assert.deepEqual(audit.values[5], {
    score: { from: undefined, to: "80分" },
    price: { from: "100元/小时", to: "120元/小时" }
  });
});

test("creating with the same idempotency key returns the existing order", async () => {
  const calls = [];
  const existing = { id: "o1", order_no: "071601", status: "active", version: 1, grade: "初二", subject: "数学", area: "雁塔区", address: "地址", lesson_time: "周末", price: "100元/小时" };
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (/idempotency_key/.test(text) && /SELECT/.test(text)) return { rows: [existing] };
      return { rows: [] };
    },
    release() {}
  };
  const repository = createRepository({ async connect() { return client; }, async query() { return { rows: [] }; } });
  const order = await repository.createOrder({ idempotencyKey: "same-key", grade: "初二" }, { id: "a1", name: "中介A" });
  assert.equal(order.orderNo, "071601");
  assert.equal(calls.some((call) => /INSERT INTO orders/.test(call.text)), false);
});
