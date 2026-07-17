# Address Privacy and Demo Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split public and detailed addresses, require parent and agent WeChat for publication, replace the corrupt 100-row demo batch with 50 complete UTF-8 demo orders, and publish the result to GitHub.

**Architecture:** Add `orders.rough_address` while retaining `orders.address` as the private detailed address. Keep privacy enforcement in the teacher repository query as well as the public-domain mapper, and enforce required data at parsing, import validation, direct writes, and publication. Use a checked, idempotent database replacement script for the one-time demo data operation.

**Tech Stack:** Node.js 24, Fastify 5, PostgreSQL/Neon, browser JavaScript, Node test runner, GitHub/Vercel deployment.

## Global Constraints

- `area` remains the administrative filter and is not reused as the rough address.
- Teachers receive `roughAddress` as the displayed address and never receive detailed address, parent WeChat, phone, internal notes, or raw text.
- Parent WeChat is required for all new or updated orders; phone remains optional.
- Publishing requires the actor to be an active staff agent with non-empty WeChat.
- Only batch `58f88b6d-818e-410d-835b-9dfb1c4860eb` may be deleted, and deletion stops unless it owns exactly 100 orders.
- The final database count must be 99 non-deleted orders: 49 retained plus 50 new demo orders.

---

### Task 1: Database field and privacy contract

**Files:**
- Create: `db/migrations/009_address_privacy.sql`
- Modify: `db/schema.sql`
- Modify: `src/domain.js`
- Modify: `src/repository.js`
- Test: `tests/schema.test.js`
- Test: `tests/repository.test.js`
- Test: `tests/stability.test.js`

**Interfaces:**
- Consumes: existing `mapOrder(row)`, `publicOrder(order)`, `buildTeacherOrderQuery(options)`.
- Produces: `roughAddress: string` on internal orders; teacher results expose public address only.

- [ ] **Step 1: Write failing schema and privacy tests**

```js
test("address privacy migration adds and backfills rough address", () => {
  assert.match(migration009, /ADD COLUMN IF NOT EXISTS rough_address TEXT/);
  assert.match(migration009, /UPDATE orders SET rough_address = area/);
});

test("teacher query selects rough address and excludes detailed address", () => {
  const query = buildTeacherOrderQuery({ page: 1 });
  assert.match(query.text, /o\.rough_address AS address/);
  assert.doesNotMatch(query.text, /o\.address[,\s]/);
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `pnpm test -- tests/schema.test.js tests/repository.test.js tests/stability.test.js`

Expected: failures because migration 009 and `roughAddress` do not exist and teacher query still selects `o.address`.

- [ ] **Step 3: Add migration and minimal mapping changes**

```sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rough_address TEXT;
UPDATE orders SET rough_address = area WHERE NULLIF(btrim(rough_address), '') IS NULL;
ALTER TABLE orders ALTER COLUMN rough_address SET NOT NULL;
INSERT INTO schema_migrations(version, name) VALUES (9, 'address privacy and required wechat')
ON CONFLICT (version) DO NOTHING;
```

Update `mapOrder` to return both `roughAddress` and private `address`. Update the teacher SELECT to expose `o.rough_address AS address` without selecting `o.address`. Keep `src/domain.js#publicOrder` as a second privacy boundary by mapping `address: order.roughAddress || order.address` and omitting `roughAddress` and all sensitive fields from the returned object.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `pnpm test -- tests/schema.test.js tests/repository.test.js tests/stability.test.js`

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/009_address_privacy.sql db/schema.sql src/domain.js src/repository.js tests/schema.test.js tests/repository.test.js tests/stability.test.js
git commit -m "Add public and detailed address privacy"
```

---

### Task 2: Parsing and validation rules

**Files:**
- Modify: `platform-core.js`
- Modify: `src/imports.js`
- Modify: `src/repository.js`
- Test: `tests/imports.test.js`
- Test: `tests/order-write.test.js`
- Test: `tests/repository-behavior.test.js`

**Interfaces:**
- Consumes: raw order text and staged import rows.
- Produces: `parsedData.roughAddress`, `parsedData.address`, and required-field warnings for both addresses and `parentWechat`.

- [ ] **Step 1: Write parser tests from the approved examples**

```js
test("plain address is public while detailed address stays separate", () => {
  const parsed = parseOrderText(`地址：灞桥区纺织城林河春天\n详细地址：林河春天8号楼2单元\n家长微信：demoParent01`);
  assert.equal(parsed.roughAddress, "灞桥区纺织城林河春天");
  assert.equal(parsed.address, "林河春天8号楼2单元");
  assert.equal(parsed.parentWechat, "demoParent01");
});
```

Add validation cases proving any missing `roughAddress`, `address`, or `parentWechat` produces `needs_review`.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `pnpm test -- tests/imports.test.js tests/order-write.test.js tests/repository-behavior.test.js`

Expected: parser has no `roughAddress`; missing parent WeChat currently passes.

- [ ] **Step 3: Implement aliases and required fields**

Use these exact aliases:

```js
roughAddress: ["粗略地址", "补习地址", "地址", "位置", "roughAddress"],
address: ["详细地址", "具体地址", "门牌地址", "address"],
parentWechat: ["家长微信", "微信", "parentWechat"]
```

Extend both import and direct-write required lists with `roughAddress`, `address`, and `parentWechat`. Add `assertPublishingActor(actor)` in `src/repository.js` to reject missing actor WeChat before `createOrder` and `publishImportBatch`.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `pnpm test -- tests/imports.test.js tests/order-write.test.js tests/repository-behavior.test.js`

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

```bash
git add platform-core.js src/imports.js src/repository.js tests/imports.test.js tests/order-write.test.js tests/repository-behavior.test.js
git commit -m "Require addresses and WeChat for order publishing"
```

---

### Task 3: Agent and teacher user interfaces

**Files:**
- Modify: `agent.html`
- Modify: `app.js`
- Modify: `styles.css` only if existing layout cannot accommodate the added field.
- Test: `app.test.js`
- Test: `tests/api.test.js`

**Interfaces:**
- Consumes: internal order objects containing `roughAddress` and `address`; teacher API objects containing public `address` and `agentWechat`.
- Produces: separate agent form/detail fields and prominent teacher-facing intermediary WeChat.

- [ ] **Step 1: Write failing markup and API tests**

```js
test("agent form requires both addresses and parent WeChat", () => {
  assert.match(agentHtml, /name="roughAddress" required/);
  assert.match(agentHtml, /name="address" required/);
  assert.match(agentHtml, /name="parentWechat" required/);
});
```

Update API fixtures so teacher orders contain only public `address`; assert response JSON does not contain `roughAddress`, `parentWechat`, or `detailedAddress` and does contain `agentWechat`.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `pnpm test -- app.test.js tests/api.test.js`

Expected: missing `roughAddress` form input and parent WeChat is not required.

- [ ] **Step 3: Implement minimal UI changes**

Add form inputs:

```html
<input name="roughAddress" required placeholder="粗略地址，例如：交大创新港附近" />
<input name="address" required placeholder="详细地址，仅中介可见，例如：小区8号楼2单元" />
<input name="parentWechat" required placeholder="家长微信，仅中介可见" />
```

Update parsing review, form serialization, normalization, edit diff labels, and agent details to use both fields. Teacher rendering continues using `order.address` (the API public alias) and displays `order.agentWechat` as an explicit “中介微信” row.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `pnpm test -- app.test.js tests/api.test.js`

Expected: focused UI and API tests pass.

- [ ] **Step 5: Commit**

```bash
git add agent.html app.js styles.css app.test.js tests/api.test.js
git commit -m "Show public addresses and required WeChat fields"
```

---

### Task 4: Safe UTF-8 demo replacement script

**Files:**
- Create: `db/replace-demo-orders.js`
- Modify: `package.json`
- Test: `tests/demo-replacement.test.js`

**Interfaces:**
- Consumes: old batch ID, active staff account `001`, repository import APIs.
- Produces: one completed 50-row import batch with complete Unicode fields and unique virtual parent WeChat values.

- [ ] **Step 1: Write failing generator and safety tests**

```js
test("generator creates 50 complete normal-looking orders", () => {
  const items = buildDemoItems();
  assert.equal(items.length, 50);
  for (const item of items) {
    assert.ok(item.parsedData.roughAddress);
    assert.ok(item.parsedData.address);
    assert.match(item.parsedData.parentWechat, /^[a-zA-Z][-_a-zA-Z0-9]{5,19}$/);
    assert.doesNotMatch(JSON.stringify(item), /\?{3,}/);
  }
});
```

Test `assertOldBatchCount(100)` succeeds and any other count throws before deletion.

- [ ] **Step 2: Run test and confirm RED**

Run: `pnpm test -- tests/demo-replacement.test.js`

Expected: module does not exist.

- [ ] **Step 3: Implement generator and transaction safety**

Export `buildDemoItems()` and `assertOldBatchCount(count)`. In `main()`, require migration 009, verify old batch owns exactly 100 orders, create the new 50-row batch first, require `readyCount === 50`, delete the 100 old orders and old batch in a database transaction, publish the new batch in one 50-row call, and verify status `completed`. Use Chinese literals stored directly in this UTF-8 JavaScript file; do not pipe generated source through PowerShell.

Add package script:

```json
"db:replace-demo": "node db/replace-demo-orders.js"
```

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `pnpm test -- tests/demo-replacement.test.js`

Expected: all replacement tests pass without touching the database.

- [ ] **Step 5: Commit**

```bash
git add db/replace-demo-orders.js package.json tests/demo-replacement.test.js
git commit -m "Add safe demo order replacement"
```

---

### Task 5: Full verification, migration, and data replacement

**Files:**
- Modify only if verification uncovers a tested defect.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: migrated cloud database with 99 retained/new non-deleted orders and a fully passing repository.

- [ ] **Step 1: Run full tests**

Run: `pnpm test`

Expected: zero failed tests; database integration tests may remain explicitly skipped unless enabled.

- [ ] **Step 2: Apply migration 009**

Run: `pnpm run db:migrate`

Expected: migration 009 applied once and schema version 9 recorded.

- [ ] **Step 3: Run the safe replacement**

Run: `pnpm run db:replace-demo`

Expected JSON includes `deletedOldOrders: 100`, `publishedNewOrders: 50`, `needsReview: 0`, `totalOrders: 99`, and `batchStatus: "completed"`.

- [ ] **Step 4: Verify both APIs against the local server**

Run cookie-less teacher API and authenticated agent API checks. Teacher payload must show normal Chinese, public address, and intermediary WeChat, and must not serialize detailed address or parent WeChat. Agent payload must contain both addresses and parent WeChat.

- [ ] **Step 5: Run full tests again after database mutation**

Run: `pnpm test`

Expected: zero failed tests.

---

### Task 6: GitHub publication and deployment verification

**Files:**
- No new source files.

**Interfaces:**
- Consumes: verified main branch.
- Produces: GitHub `main` and successful CI/Vercel checks.

- [ ] **Step 1: Review the final diff and worktree**

Run: `git status --short` and `git diff --check`.

Expected: only intended files are changed and no whitespace errors exist.

- [ ] **Step 2: Commit any final plan or verification updates**

```bash
git add docs/superpowers/plans/2026-07-17-address-privacy-and-demo-data.md
git commit -m "Plan address privacy and demo replacement"
```

- [ ] **Step 3: Push main**

Run: `git push origin main`

Expected: remote `main` advances to the verified local commit.

- [ ] **Step 4: Verify remote checks**

Inspect GitHub Actions and Vercel deployment statuses for the pushed commit.

Expected: test workflow and deployment complete successfully.
