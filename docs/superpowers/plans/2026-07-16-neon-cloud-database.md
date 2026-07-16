# Neon Cloud Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the platform backend from a local JSON-only prototype to a Neon PostgreSQL-backed service while keeping a deliberate local-demo fallback.

**Architecture:** The backend reads `DATABASE_URL` from an untracked `.env` file. A database module owns connection validation, schema execution, and migration of the existing demo snapshot. The HTTP backend chooses Neon when configured and retains the JSON file only when no cloud URL is configured.

**Tech Stack:** Node.js built-in HTTP server, PostgreSQL 18 on Neon, `pg`, `dotenv`, Node test runner.

## Global Constraints

- Never commit `.env` or any database credential.
- Teacher APIs must continue to omit parent contact details and internal notes.
- Existing JSON data must be copied to Neon once without exposing password hashes in exports.
- Keep the existing local JSON mode for offline demonstration only.

---

### Task 1: Configure private cloud connection

**Files:**
- Create: `.env`
- Create: `.env.example`
- Modify: `.gitignore`
- Modify: `app.test.js`

- [ ] Add a failing test asserting the server reports `neon` when `DATABASE_URL` is configured and `local` otherwise.
- [ ] Add the private connection string only to `.env`; add a redacted example to `.env.example`; ignore `.env`.
- [ ] Run `node --test app.test.js` and confirm the missing database-mode import fails.

### Task 2: Add a Neon connection module

**Files:**
- Create: `db/neon.js`
- Create: `package.json`
- Modify: `server.js`
- Modify: `app.test.js`

- [ ] Implement `databaseMode(env)` and lazy `pg` pool creation.
- [ ] Run the focused test and confirm it passes in local mode.
- [ ] Verify a Neon connection with `SELECT 1` without printing the connection string.

### Task 3: Initialize the database and migrate the prototype snapshot

**Files:**
- Create: `db/migrate.js`
- Modify: `db/schema.sql`
- Modify: `README.md`

- [ ] Add a failing test asserting the migration module exposes a safe migration entry point.
- [ ] Run the test and confirm it fails because the migration module does not exist.
- [ ] Execute the schema on Neon, migrate the existing JSON snapshot, and verify order and agent counts using aggregate queries only.
- [ ] Re-run the complete test suite.

### Task 4: Switch runtime persistence to Neon

**Files:**
- Modify: `server.js`
- Modify: `db/neon.js`
- Modify: `app.test.js`

- [ ] Add integration coverage for selecting Neon mode without a live credential in test output.
- [ ] Change API request loading/saving to use the cloud persistence adapter when configured.
- [ ] Start the server, exercise login and teacher-orders APIs, and verify the response does not leak private fields.
