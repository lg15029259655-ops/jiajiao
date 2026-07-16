const test = require("node:test");
const assert = require("node:assert/strict");

const { buildAgentOrderQuery, buildTeacherOrderQuery } = require("../src/repository.js");

test("teacher listing query is public, filtered and limited in PostgreSQL", () => {
  const query = buildTeacherOrderQuery({
    grades: ["初二"], subjects: ["数学"], areas: ["雁塔区"], keyword: "科技路", page: 2
  });
  assert.match(query.text, /o\.status = 'active'/);
  assert.match(query.text, /LIMIT 10 OFFSET/);
  assert.match(query.text, /COUNT\(\*\) OVER\(\)/);
  assert.doesNotMatch(query.text, /parent_phone|parent_wechat|internal_note|raw_text/);
  assert.deepEqual(query.values.slice(0, 4), [["初二"], ["%数学%"], ["雁塔区"], "%科技路%"]);
});

test("agent listing query separates working and history scopes", () => {
  const working = buildAgentOrderQuery({ scope: "working", status: "paused", keyword: "139", page: 1 });
  const history = buildAgentOrderQuery({ scope: "history", page: 1 });
  assert.match(working.text, /o\.status = ANY/);
  assert.deepEqual(working.values[0], ["active", "paused"]);
  assert.equal(working.values.includes("paused"), true);
  assert.deepEqual(history.values[0], ["completed", "cancelled", "deleted"]);
  assert.match(history.text, /LIMIT 10 OFFSET/);
});
