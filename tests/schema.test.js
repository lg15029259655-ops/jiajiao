const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const migration = fs.readFileSync("./db/migrations/002_stabilize.sql", "utf8");
const auditMigration = fs.readFileSync("./db/migrations/003_audit_and_privacy.sql", "utf8");
const importMigration = fs.readFileSync("./db/migrations/004_import_safety.sql", "utf8");
const constraintMigration = fs.readFileSync("./db/migrations/006_identity_and_status_constraints.sql", "utf8");
const pipelineMigration = fs.readFileSync("./db/migrations/007_import_pipeline_and_followups.sql", "utf8");
const numberingMigrationPath = "./db/migrations/008_order_number_sequence.sql";

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

test("pipeline migration stores parsing evidence, progress and follow-up timestamps", () => {
  assert.match(pipelineMigration, /start_time_text/);
  assert.match(pipelineMigration, /teacher_gender_requirement/);
  assert.match(pipelineMigration, /field_confidence JSONB/);
  assert.match(pipelineMigration, /field_sources JSONB/);
  assert.match(pipelineMigration, /content_fingerprint/);
  assert.match(pipelineMigration, /last_processed_row/);
  assert.match(pipelineMigration, /lock_follow_up_at/);
  assert.match(pipelineMigration, /VALUES \(7,/);
});

test("order numbering migration creates a global non-cycling bigint sequence", () => {
  assert.equal(fs.existsSync(numberingMigrationPath), true);
  const numberingMigration = fs.readFileSync(numberingMigrationPath, "utf8");
  assert.match(numberingMigration, /CREATE SEQUENCE IF NOT EXISTS order_number_seq AS BIGINT/);
  assert.match(numberingMigration, /NO CYCLE/);
  assert.match(numberingMigration, /\^XJ\[0-9\]\+\$/);
  assert.match(numberingMigration, /is_called/);
  assert.match(numberingMigration, /VALUES \(8,/);
  assert.doesNotMatch(numberingMigration, /DROP TABLE|DROP SEQUENCE/);
});
