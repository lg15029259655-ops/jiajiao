const test = require("node:test");
const assert = require("node:assert/strict");

const { assertOldBatchCount, buildDemoItems } = require("../db/replace-demo-orders.js");

test("demo generator creates 50 complete normal-looking UTF-8 orders", () => {
  const items = buildDemoItems();
  assert.equal(items.length, 50);
  const parentWechats = new Set();
  for (const item of items) {
    const data = item.parsedData;
    assert.ok(data.grade);
    assert.ok(data.subject);
    assert.ok(data.score);
    assert.ok(data.lessonTime);
    assert.ok(data.price);
    assert.ok(data.roughAddress);
    assert.ok(data.address);
    assert.ok(data.requirement);
    assert.match(data.parentWechat, /^[a-zA-Z][-_a-zA-Z0-9]{5,19}$/);
    assert.doesNotMatch(JSON.stringify(item), /\?{3,}/);
    parentWechats.add(data.parentWechat);
  }
  assert.equal(parentWechats.size, 50);
});

test("old demo batch deletion requires exactly 100 owned orders", () => {
  assert.doesNotThrow(() => assertOldBatchCount(100));
  for (const count of [0, 49, 99, 101]) {
    assert.throws(() => assertOldBatchCount(count), /expected exactly 100/i);
  }
});
