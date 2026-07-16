const test = require("node:test");
const assert = require("node:assert/strict");

const { buildApp, createTemporaryPassword, csvCell } = require("../src/app.js");
const { hashPassword } = require("../src/security.js");

function fakeRepository({ role = "staff", mustChangePassword = false } = {}) {
  const agent = {
    id: "a1", account: "001", name: "中介A", wechat: "agent001", phone: "",
    role, active: true, mustChangePassword,
    passwordHash: hashPassword("123456", "api-test-salt", 120000)
  };
  const sessions = new Map();
  const calls = [];
  return {
    calls,
    async ping() { return true; },
    async listTeacherOrders() {
      return { items: [{ id: "o1", orderNo: "071601", status: "active", grade: "初二", subject: "数学", area: "雁塔区", address: "公开地址", agentName: "中介A", agentWechat: "agent001" }], page: 1, pageSize: 10, totalItems: 1, totalPages: 1 };
    },
    async findAgentByLogin(account) { return account === "001" ? agent : null; },
    async upgradePassword(id, passwordHashValue) { agent.passwordHash = passwordHashValue; },
    async createSession({ digest }) { sessions.set(digest, agent.id); },
    async getSessionAgent(digest) { return sessions.has(digest) ? agent : null; },
    async deleteSession(digest) { sessions.delete(digest); },
    async listAgents() { return [agent]; },
    async listAgentOrders() { return { items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1, counts: {} }; },
    async createOrder(input, actor) { calls.push(["create", input, actor]); return { id: "o2", orderNo: "071602", version: 1, status: "active" }; },
    async updateOrder(id, input, actor) { calls.push(["update", id, input, actor]); return { id, ...input, version: input.version + 1, status: "active" }; },
    async transitionOrder(id, input, actor) { calls.push(["status", id, input, actor]); return { id, status: input.status, version: input.version + 1 }; }
    ,async createImportBatch(input, actor) { calls.push(["import", input, actor]); return { id: "b1", totalCount: input.items.length, readyCount: input.items.length, needsReviewCount: 0 }; }
    ,async getImportBatch() { return { items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1 }; }
    ,async updateImportItem(id, input) { calls.push(["import-update", id, input]); return { id, ...input }; }
    ,async publishImportBatch(id, actor) { calls.push(["import-publish", id, actor]); return { publishedCount: 1, skippedCount: 0 }; }
    ,async correctOrder(id, input, actor) { calls.push(["correct", id, input, actor]); return { id, status: input.status, version: input.version + 1 }; }
  };
}

async function login(app, account = "001") {
  const response = await app.inject({ method: "POST", url: "/api/agent/login", payload: { account, password: "123456" } });
  const cookie = response.cookies.find((item) => item.name === "tutor-session");
  return { response, cookies: cookie ? { [cookie.name]: cookie.value } : {} };
}

test("health and teacher listing work without authentication", async () => {
  const app = buildApp({ repository: fakeRepository(), serveFiles: false });
  const live = await app.inject({ method: "GET", url: "/health/live" });
  const listing = await app.inject({ method: "GET", url: "/api/teacher/orders" });
  assert.equal(live.statusCode, 200);
  assert.equal(live.json().status, "ok");
  assert.equal(listing.statusCode, 200);
  assert.equal(listing.json().items.length, 1);
  assert.equal(listing.json().items[0].parentPhone, undefined);
  await app.close();
});

test("database session survives subsequent authenticated requests", async () => {
  const app = buildApp({ repository: fakeRepository(), serveFiles: false });
  const login = await app.inject({ method: "POST", url: "/api/agent/login", payload: { account: "001", password: "123456" } });
  assert.equal(login.statusCode, 200);
  assert.match(login.headers["set-cookie"], /HttpOnly/);
  assert.match(login.headers["set-cookie"], /SameSite=Strict/);
  const cookie = login.cookies.find((item) => item.name === "tutor-session");
  const me = await app.inject({ method: "GET", url: "/api/agent/me", cookies: { [cookie.name]: cookie.value } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().agent.account, "001");
  assert.equal(me.json().agent.passwordHash, undefined);
  await app.close();
});

test("errors use a stable envelope with request id", async () => {
  const app = buildApp({ repository: fakeRepository(), serveFiles: false });
  const response = await app.inject({ method: "GET", url: "/api/agent/orders" });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "AUTH_REQUIRED");
  assert.equal(typeof response.json().error.requestId, "string");
  await app.close();
});

test("staff order write routes pass actor, version and idempotency to repository", async () => {
  const repository = fakeRepository();
  const app = buildApp({ repository, serveFiles: false });
  const { cookies } = await login(app);

  const created = await app.inject({
    method: "POST", url: "/api/agent/orders", cookies,
    headers: { "idempotency-key": "request-1" },
    payload: { grade: "初二", subject: "数学", area: "雁塔区", score: "80", lessonTime: "周末", price: "200/次", address: "小寨" }
  });
  const edited = await app.inject({
    method: "PATCH", url: "/api/agent/orders/o2", cookies,
    payload: { version: 1, price: "220/次", reason: "家长调整报价" }
  });
  const changed = await app.inject({
    method: "PATCH", url: "/api/agent/orders/o2/status", cookies,
    payload: { version: 2, status: "paused", reason: "老师沟通中", assignedTeacherContact: "wx-teacher" }
  });

  assert.equal(created.statusCode, 201);
  assert.equal(edited.statusCode, 200);
  assert.equal(changed.statusCode, 200);
  assert.equal(repository.calls[0][1].idempotencyKey, "request-1");
  assert.equal(repository.calls[1][2].version, 1);
  assert.equal(repository.calls[2][2].status, "paused");
  assert.equal(repository.calls[0][2].id, "a1");
  await app.close();
});

test("order writes reject missing version and missing idempotency key", async () => {
  const app = buildApp({ repository: fakeRepository(), serveFiles: false });
  const { cookies } = await login(app);
  const create = await app.inject({ method: "POST", url: "/api/agent/orders", cookies, payload: {} });
  const edit = await app.inject({ method: "PATCH", url: "/api/agent/orders/o1", cookies, payload: { price: "200" } });
  assert.equal(create.statusCode, 400);
  assert.equal(create.json().error.code, "IDEMPOTENCY_KEY_REQUIRED");
  assert.equal(edit.statusCode, 400);
  assert.equal(edit.json().error.code, "VERSION_REQUIRED");
  await app.close();
});

test("text import is staged before publish", async () => {
  const repository = fakeRepository();
  const app = buildApp({ repository, serveFiles: false });
  const { cookies } = await login(app);
  const staged = await app.inject({
    method: "POST", url: "/api/agent/import-batches", cookies,
    payload: { sourceType: "text", content: "年级：初二\n科目：数学\n区域：雁塔区\n成绩：80分\n补习时间：周末\n报价：100元/小时\n地址：小寨" }
  });
  const published = await app.inject({ method: "POST", url: "/api/agent/import-batches/b1/publish", cookies });
  assert.equal(staged.statusCode, 201);
  assert.equal(staged.json().batch.totalCount, 1);
  assert.equal(published.statusCode, 200);
  assert.equal(repository.calls[0][0], "import");
  assert.equal(repository.calls[1][0], "import-publish");
  await app.close();
});

test("temporary-password accounts cannot write orders before changing password", async () => {
  const app = buildApp({ repository: fakeRepository({ mustChangePassword: true }), serveFiles: false });
  const { cookies } = await login(app);
  const response = await app.inject({
    method: "POST", url: "/api/agent/orders", cookies, headers: { "idempotency-key": "blocked" }, payload: {}
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "PASSWORD_CHANGE_REQUIRED");
  const listing = await app.inject({ method: "GET", url: "/api/agent/orders", cookies });
  assert.equal(listing.statusCode, 403);
  assert.equal(listing.json().error.code, "PASSWORD_CHANGE_REQUIRED");
  assert.ok(createTemporaryPassword().length >= 16);
  assert.notEqual(createTemporaryPassword(), createTemporaryPassword());
  await app.close();
});

test("static frontend routes register without exposing arbitrary project files", async () => {
  const app = buildApp({ repository: fakeRepository(), serveFiles: true });
  const teacher = await app.inject({ method: "GET", url: "/teacher.html" });
  const environment = await app.inject({ method: "GET", url: "/.env" });
  assert.equal(teacher.statusCode, 200);
  assert.match(teacher.headers["content-type"], /text\/html/);
  assert.equal(environment.statusCode, 404);
  await app.close();
});

test("admins use the dedicated correction route but cannot perform daily order writes", async () => {
  const repository = fakeRepository({ role: "admin" });
  const app = buildApp({ repository, serveFiles: false });
  const { cookies } = await login(app);
  const correction = await app.inject({
    method: "PATCH", url: "/api/admin/orders/o1/correct", cookies,
    payload: { version: 1, status: "cancelled", reason: "管理员核对历史资料" }
  });
  const dailyWrite = await app.inject({
    method: "POST", url: "/api/agent/orders", cookies, headers: { "idempotency-key": "admin-write" }, payload: {}
  });
  assert.equal(correction.statusCode, 200);
  assert.equal(repository.calls[0][0], "correct");
  assert.equal(dailyWrite.statusCode, 403);
  assert.equal(dailyWrite.json().error.code, "STAFF_ONLY");
  await app.close();
});

test("CSV export neutralizes spreadsheet formulas", () => {
  assert.equal(csvCell("=HYPERLINK(\"bad\")"), "\"'=HYPERLINK(\"\"bad\"\")\"");
  assert.equal(csvCell("+1+1"), "'+1+1");
  assert.equal(csvCell("normal"), "normal");
});
