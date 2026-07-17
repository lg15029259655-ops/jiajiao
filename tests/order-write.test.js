const test = require("node:test");
const assert = require("node:assert/strict");

const { allocateOrderNo, assertManualOrderNoAllowed, assertPublishingActor, assertRequiredOrderFields, createRepository } = require("../src/repository.js");

test("automatic order numbers use a non-resetting database sequence", async () => {
  const calls = [];
  const client = {
    async query(text) {
      calls.push(text);
      return { rows: [{ order_no: "XJ0000000001" }] };
    }
  };

  assert.equal(await allocateOrderNo(client), "XJ0000000001");
  assert.match(calls[0], /nextval\('order_number_seq'\)/);
  assert.doesNotMatch(calls[0], /current_date|YYMMDD/);
});

test("manual order numbers cannot claim the automatic XJ namespace", () => {
  assert.equal(assertManualOrderNoAllowed("001426"), "001426");
  assert.equal(assertManualOrderNoAllowed("XJ0000000001", "XJ0000000001"), "XJ0000000001");
  assert.throws(
    () => assertManualOrderNoAllowed("xj0000000001"),
    { code: "ORDER_NO_RESERVED" }
  );
});

test("new orders require both addresses and parent WeChat", () => {
  const complete = {
    grade: "初三", subject: "数学", area: "灞桥区", score: "80分", lessonTime: "周末",
    price: "80元/小时", roughAddress: "纺织城附近", address: "林河春天8号楼", parentWechat: "demoParent06"
  };
  assert.doesNotThrow(() => assertRequiredOrderFields(complete));
  for (const field of ["roughAddress", "address", "parentWechat"]) {
    assert.throws(() => assertRequiredOrderFields({ ...complete, [field]: "" }), { code: "ORDER_FIELDS_REQUIRED" });
  }
});

test("publishing staff must have intermediary WeChat", () => {
  assert.doesNotThrow(() => assertPublishingActor({ id: "a1", role: "staff", active: true, wechat: "agent001" }));
  assert.throws(() => assertPublishingActor({ id: "a1", role: "staff", active: true, wechat: "" }), { code: "AGENT_WECHAT_REQUIRED" });
});

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
  const setup = transactionPool({ id: "o1", order_no: "071601", status: "active", version: 2, grade: "初二", subject: "数学", area: "雁塔区", rough_address: "小寨附近", address: "小寨8号楼", parent_wechat: "demoParent07", lesson_time: "周末", price: "100元/小时" });
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

test("concurrent requests with one idempotency key return the winning order", async () => {
  const calls = [];
  let idempotencyLookups = 0;
  const existing = { id: "o2", order_no: "XJ0000000002", status: "active", version: 1, grade: "初二", subject: "数学", area: "雁塔区", address: "地址", lesson_time: "周末", price: "100元/小时" };
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (/SELECT o\.\*.*idempotency_key/s.test(text)) {
        idempotencyLookups += 1;
        return { rows: idempotencyLookups === 1 ? [] : [existing] };
      }
      if (/SELECT order_no, parent_phone/.test(text)) return { rows: [] };
      if (/nextval\('order_number_seq'\)/.test(text)) return { rows: [{ order_no: "XJ0000000003" }] };
      if (/INSERT INTO orders/.test(text)) return { rows: [] };
      return { rows: [] };
    },
    release() {}
  };
  const repository = createRepository({ async connect() { return client; } });
  const order = await repository.createOrder({
    idempotencyKey: "same-concurrent-key", grade: "初二", subject: "数学", area: "雁塔区",
    score: "80分", lessonTime: "周末", price: "100元/小时", roughAddress: "小寨附近",
    address: "小寨8号楼", parentWechat: "demoParent08"
  }, { id: "a1", name: "中介A" });

  assert.equal(order.orderNo, "XJ0000000002");
  assert.match(calls.find((call) => /INSERT INTO orders/.test(call.text)).text,
    /ON CONFLICT \(idempotency_key\).*DO NOTHING/s);
  assert.equal(idempotencyLookups, 2);
});
