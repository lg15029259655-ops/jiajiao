const test = require("node:test");
const assert = require("node:assert/strict");

const packageJson = require("../package.json");
const appModule = require("../src/app.js");
const { resolveHost } = require("../server.js");
const { resolveAllowedOrigin, resolveAllowedOrigins } = appModule;

test("cloud runtime is pinned to Node 24 for ESM dependency compatibility", () => {
  assert.equal(packageJson.engines.node, "24.x");
});

test("Fastify cookie plugin is pinned before its ESM-only transitive upgrade", () => {
  assert.equal(packageJson.dependencies["@fastify/cookie"], "11.0.2");
});

test("Vercel entry module has a callable default export", () => {
  assert.equal(typeof appModule, "function");
  assert.equal(typeof appModule.buildApp, "function");
});

test("Vercel bundle explicitly loads the public frontend assets", () => {
  const files = appModule.loadPublicFiles();
  assert.match(files.teacherHtml, /<!doctype html>/i);
  assert.match(files.agentHtml, /<!doctype html>/i);
  assert.match(files.styles, /body\s*\{/i);
  assert.ok(files.appScript.length > 0);
  assert.ok(files.platformCore.length > 0);
});

test("local server defaults to loopback", () => {
  assert.equal(resolveHost({}), "127.0.0.1");
});

test("production server defaults to all network interfaces", () => {
  assert.equal(resolveHost({ NODE_ENV: "production" }), "0.0.0.0");
});

test("explicit HOST overrides the environment default", () => {
  assert.equal(resolveHost({ NODE_ENV: "production", HOST: "10.0.0.8" }), "10.0.0.8");
});

test("Render public URL is used as the trusted origin automatically", () => {
  assert.equal(
    resolveAllowedOrigin({ RENDER_EXTERNAL_URL: "https://jiajiao-platform.onrender.com" }),
    "https://jiajiao-platform.onrender.com"
  );
});

test("explicit APP_ORIGIN takes precedence over the hosting URL", () => {
  assert.equal(
    resolveAllowedOrigin({
      APP_ORIGIN: "https://orders.example.com",
      RENDER_EXTERNAL_URL: "https://jiajiao-platform.onrender.com"
    }),
    "https://orders.example.com"
  );
});

test("Vercel production URL is converted to a trusted HTTPS origin", () => {
  assert.equal(
    resolveAllowedOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "jiajiao.vercel.app" }),
    "https://jiajiao.vercel.app"
  );
});

test("teacher and agent subdomains are both trusted when configured", () => {
  assert.deepEqual(
    resolveAllowedOrigins({
      TEACHER_ORIGIN: "https://orders.example.com",
      AGENT_ORIGIN: "https://agent.example.com",
      APP_ORIGINS: "https://preview.example.com, https://agent.example.com"
    }),
    ["https://preview.example.com", "https://agent.example.com", "https://orders.example.com"]
  );
});
