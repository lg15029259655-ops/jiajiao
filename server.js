const { buildApp } = require("./src/app.js");
const { createPool } = require("./src/database.js");
const { createRepository } = require("./src/repository.js");

function resolveHost(env = process.env) {
  return env.HOST || (env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
}

async function start() {
  if (process.env.APP_MODE === "demo") {
    throw new Error("APP_MODE=demo requires the separate demo server and cannot use the production entry point");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required; production never falls back to local JSON or localStorage");
  }

  const pool = createPool(process.env.DATABASE_URL);
  const repository = createRepository(pool);
  const ready = await repository.ping();
  if (!ready) throw new Error("Database readiness check failed");

  const app = buildApp({ repository });
  const port = Number(process.env.PORT || 8765);
  const host = resolveHost();
  await app.listen({ port, host });
  console.log(`Tutor platform listening on http://${host}:${port}`);
  return app;
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Unable to start tutor platform:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { resolveHost, start };
