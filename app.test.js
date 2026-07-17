const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const core = require("./platform-core.js");
const { databaseMode, normalizeConnectionString } = require("./db/neon.js");

test("public and staff status views match the production workflow", () => {
  const orders = [
    { id: "o1", orderNo: "071601", status: "active", grade: "初二", subject: "数学", area: "雁塔区", address: "小寨", parentPhone: "13900000000", rawText: "private" },
    { id: "o2", orderNo: "071602", status: "paused", grade: "高一", subject: "物理", area: "碑林区", address: "边家村" },
    { id: "o3", orderNo: "071603", status: "completed", grade: "高二", subject: "化学", area: "线上", address: "线上" }
  ];
  assert.deepEqual(core.getTeacherOrders(orders).map((item) => item.id), ["o1"]);
  assert.deepEqual(core.getStaffOrders(orders).map((item) => item.id), ["o1", "o2"]);
  assert.deepEqual(core.getArchivedOrders(orders).map((item) => item.id), ["o3"]);
  const publicItem = core.queryTeacherOrders(orders, { page: 1 }).items[0];
  assert.equal(publicItem.parentPhone, undefined);
  assert.equal(publicItem.rawText, undefined);
  assert.deepEqual(core.TERMINAL_STATUSES, ["completed", "cancelled", "deleted"]);
  assert.deepEqual(core.STAFF_ACTIONS.completed, []);
});

test("production pages are API-only and contain no demo credentials or inquiry UI", () => {
  const appJs = fs.readFileSync("./app.js", "utf8");
  const agentHtml = fs.readFileSync("./agent.html", "utf8");
  const teacherHtml = fs.readFileSync("./teacher.html", "utf8");
  const styles = fs.readFileSync("./styles.css", "utf8");
  assert.match(agentHtml, /data-mode="api"/);
  assert.match(teacherHtml, /data-mode="api"/);
  assert.doesNotMatch(agentHtml, /admin123|001\s*\/\s*123456/);
  assert.doesNotMatch(teacherHtml, /data-inquiry|我想咨询/);
  assert.doesNotMatch(appJs, /api\/teacher\/inquiries/);
  assert.doesNotMatch(appJs, /nextStatus === "archived"/);
  assert.match(appJs, /visibleOrders/);
  assert.match(appJs, /idempotency-key/);
  assert.doesNotMatch(appJs, /navigator\.userAgent|maxTouchPoints|data-device/);
  assert.doesNotMatch(styles, /html\[data-device=/);
  assert.match(styles, /@media \(max-width: 767px\)/);
  assert.match(styles, /@media \(min-width: 768px\) and \(max-width: 1199px\)/);
  assert.match(styles, /@media \(min-width: 1200px\)/);
  assert.match(styles, /loading-card/);
  for (const field of ["startTimeText", "lessonFrequency", "lessonDuration", "teacherGenderRequirement", "teacherEducationRequirement"]) {
    assert.match(appJs, new RegExp(`${field}: String\\(order\\.${field}`));
  }
});

test("database configuration keeps TLS parameters and requires explicit cloud mode", () => {
  assert.equal(databaseMode({}), "local");
  assert.equal(databaseMode({ DATABASE_URL: "postgresql://example" }), "neon");
  assert.equal(
    normalizeConnectionString("postgresql://user:secret@example.test/db?sslmode=require&application_name=tutor"),
    "postgresql://user:secret@example.test/db?application_name=tutor"
  );
});
