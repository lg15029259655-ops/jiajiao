const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const migration = fs.readFileSync("./db/migrations/002_stabilize.sql", "utf8");
const auditMigration = fs.readFileSync("./db/migrations/003_audit_and_privacy.sql", "utf8");
const importMigration = fs.readFileSync("./db/migrations/004_import_safety.sql", "utf8");
const constraintMigration = fs.readFileSync("./db/migrations/006_identity_and_status_constraints.sql", "utf8");

test("stability migration adds concurrency, sessions and import staging", () => {
  assert.match(migration, /schema_migrations/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS version/);
  assert.match(migration, /idempotency_key/);
  assert.match(migration, /closed_at/);
  assert.match(migration, /anonymized_at/);
  assert.match(migration, /must_change_password/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS import_items/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS order_sequences/);
  assert.doesNotMatch(migration, /'archived'/);
});

test("audit migration stores structured changes and removes legacy inquiry data", () => {
  assert.match(auditMigration, /ADD COLUMN IF NOT EXISTS changes JSONB/);
  assert.match(auditMigration, /DROP TABLE IF EXISTS teacher_inquiries/);
  assert.match(auditMigration, /schema_migrations/);
});

test("import migration enables similarity matching and item concurrency", () => {
  assert.match(importMigration, /CREATE EXTENSION IF NOT EXISTS pg_trgm/);
  assert.match(importMigration, /ADD COLUMN IF NOT EXISTS version INTEGER/);
  assert.match(importMigration, /gin_trgm_ops/);
});

test("final constraints enforce five order states and cross-field login uniqueness", () => {
  assert.doesNotMatch(constraintMigration, /IN \('pending_review'/);
  assert.match(constraintMigration, /enforce_agent_login_identity_uniqueness/);
  assert.match(constraintMigration, /pg_advisory_xact_lock/);
  assert.match(constraintMigration, /VALUES \(6,/);
});
