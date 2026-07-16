const test = require("node:test");
const assert = require("node:assert/strict");

const packageJson = require("../package.json");
const { resolveHost } = require("../server.js");
const { resolveAllowedOrigin } = require("../src/app.js");

test("cloud runtime is pinned to Node 24 for ESM dependency compatibility", () => {
  assert.equal(packageJson.engines.node, "24.x");
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
