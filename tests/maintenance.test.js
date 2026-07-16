const test = require("node:test");
const assert = require("node:assert/strict");

const { runMaintenance } = require("../db/maintenance.js");
const { decryptBackup, encryptBackup, validateBackup } = require("../db/backup-format.js");
const { createBackup, TABLES } = require("../db/backup.js");

test("maintenance anonymizes terminal orders and removes expired sessions", async () => {
  const calls = [];
  const pool = {
    async query(text, values) {
      calls.push({ text, values });
      if (/UPDATE orders/.test(text)) return { rowCount: 4 };
      if (/UPDATE order_logs/.test(text)) return { rowCount: 9 };
      if (/DELETE FROM sessions/.test(text)) return { rowCount: 2 };
      return { rows: [] };
    }
  };
  const result = await runMaintenance(pool, new Date("2026-07-16T00:00:00Z"));
  assert.deepEqual(result, { anonymizedOrders: 4, scrubbedAuditLogs: 9, deletedSessions: 2 });
  assert.match(calls[0].text, /parent_phone = NULL/);
  assert.match(calls[0].text, /interval '6 months'/);
  assert.match(calls[1].text, /changes = changes - ARRAY/);
  assert.match(calls[1].text, /reason = NULL/);
});

test("backup payload is encrypted and authenticated", () => {
  const payload = { formatVersion: 1, createdAt: "2026-07-16T00:00:00Z", tables: { agents: [{ id: "a1" }], orders: [] } };
  const encrypted = encryptBackup(payload, "strong-test-key");
  assert.doesNotMatch(encrypted, /\"a1\"/);
  assert.deepEqual(decryptBackup(encrypted, "strong-test-key"), payload);
  assert.throws(() => decryptBackup(encrypted, "wrong-key"));
  assert.deepEqual(validateBackup(payload).counts, { agents: 1, orders: 0 });
  assert.throws(() => validateBackup({ formatVersion: 2, createdAt: payload.createdAt, tables: {} }));
});

test("backup reads all tables from one repeatable-read snapshot", async () => {
  const calls = [];
  const client = {
    async query(text) { calls.push(text); return { rows: [] }; },
    release() { calls.push("RELEASE"); }
  };
  const payload = await createBackup({ async connect() { return client; } });
  assert.equal(calls[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(calls.at(-2), "COMMIT");
  assert.equal(calls.at(-1), "RELEASE");
  assert.deepEqual(Object.keys(payload.tables), TABLES);
});
