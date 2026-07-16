const path = require("node:path");
const crypto = require("node:crypto");
const Fastify = require("fastify");
const cookie = require("@fastify/cookie");
const rateLimit = require("@fastify/rate-limit");
const staticFiles = require("@fastify/static");
const multipart = require("@fastify/multipart");
const { needsPasswordUpgrade, hashPassword, sessionToken, tokenDigest, verifyPassword } = require("./security.js");
const { domainError, publicOrder } = require("./domain.js");
const { MAX_IMPORT_BYTES, parseCsvBuffer, parseSpreadsheetBuffer, parseTextItems } = require("./imports.js");

const SESSION_TTL_SECONDS = 60 * 60 * 12;

function sanitizeAgent(agent) {
  const { passwordHash, ...safe } = agent;
  return safe;
}

function resolveAllowedOrigin(env = process.env) {
  if (env.APP_ORIGIN) return env.APP_ORIGIN;
  if (env.RENDER_EXTERNAL_URL) return env.RENDER_EXTERNAL_URL;
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return undefined;
}

function buildApp({ repository, serveFiles = true, production = process.env.NODE_ENV === "production", allowedOrigin = resolveAllowedOrigin() } = {}) {
  if (!repository) throw new Error("repository is required");
  const app = Fastify({ logger: false, trustProxy: production, requestIdHeader: "x-request-id", bodyLimit: MAX_IMPORT_BYTES });
  const cookieName = production ? "__Host-tutor-session" : "tutor-session";

  app.register(cookie);
  app.register(rateLimit, { global: false });
  app.register(multipart, { limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 5 } });
  if (serveFiles) {
    app.register(staticFiles, { root: path.join(__dirname, ".."), serve: false });
  }

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "same-origin");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    reply.header("cache-control", "no-store");
    return payload;
  });

  app.addHook("preHandler", async (request) => {
    if (!production || ["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    const origin = request.headers.origin;
    if (!allowedOrigin || origin !== allowedOrigin) throw domainError("ORIGIN_REJECTED", "请求来源不受信任", 403);
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = Number(error.statusCode || 500);
    const code = error.code && !String(error.code).startsWith("FST_") ? error.code : (statusCode >= 500 ? "INTERNAL_ERROR" : "REQUEST_INVALID");
    if (statusCode >= 500) console.error(`[${request.id}]`, error.code || error.message);
    reply.code(statusCode).send({ error: { code, message: statusCode >= 500 ? "服务暂时不可用，请稍后重试" : error.message, requestId: request.id } });
  });

  async function authenticate(request) {
    const token = request.cookies[cookieName];
    if (!token) throw domainError("AUTH_REQUIRED", "请先登录中介后台", 401);
    const agent = await repository.getSessionAgent(tokenDigest(token));
    if (!agent?.active) throw domainError("AUTH_REQUIRED", "登录已失效，请重新登录", 401);
    request.agent = agent;
    request.sessionDigest = tokenDigest(token);
  }

  async function requireStaff(request) {
    await authenticate(request);
    if (request.agent.role !== "staff") {
      throw domainError("STAFF_ONLY", "管理员账号不参与日常订单操作", 403);
    }
    if (request.agent.mustChangePassword) {
      throw domainError("PASSWORD_CHANGE_REQUIRED", "首次登录必须先修改临时密码", 403);
    }
  }

  async function requireAdmin(request) {
    await authenticate(request);
    if (request.agent.role !== "admin") throw domainError("ADMIN_ONLY", "仅管理员可以执行此操作", 403);
  }

  async function requirePasswordChanged(request) {
    await authenticate(request);
    if (request.agent.mustChangePassword) {
      throw domainError("PASSWORD_CHANGE_REQUIRED", "首次登录必须先修改临时密码", 403);
    }
  }

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    let ready = false;
    try { ready = await repository.ping(); } catch { ready = false; }
    if (!ready) reply.code(503);
    return { status: ready ? "ok" : "unavailable" };
  });

  app.get("/api/teacher/orders", async (request) => {
    const query = request.query || {};
    const result = await repository.listTeacherOrders({
      grades: arrayValue(query.grade), subjects: arrayValue(query.subject), areas: arrayValue(query.area),
      keyword: query.keyword || "", page: query.page || 1
    });
    return { ...result, items: result.items.map(publicOrder) };
  });

  app.post("/api/agent/login", {
    config: { rateLimit: { max: 5, timeWindow: "15 minutes", keyGenerator: (request) => `${request.ip}:${request.body?.account || ""}` } },
    schema: { body: { type: "object", required: ["account", "password"], additionalProperties: false, properties: { account: { type: "string", minLength: 1, maxLength: 100 }, password: { type: "string", minLength: 1, maxLength: 200 } } } }
  }, async (request, reply) => {
    const account = request.body.account.trim();
    const agent = await repository.findAgentByLogin(account);
    if (!agent || !agent.active || !verifyPassword(request.body.password, agent.passwordHash)) {
      throw domainError("LOGIN_INVALID", "账号或密码不正确", 401);
    }
    if (needsPasswordUpgrade(agent.passwordHash)) {
      await repository.upgradePassword(agent.id, hashPassword(request.body.password));
    }
    const token = sessionToken();
    await repository.createSession({
      digest: tokenDigest(token), agentId: agent.id, expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
      userAgent: request.headers["user-agent"] || "", ip: request.ip
    });
    reply.setCookie(cookieName, token, { path: "/", httpOnly: true, sameSite: "strict", secure: production, maxAge: SESSION_TTL_SECONDS });
    return { agent: sanitizeAgent(agent) };
  });

  app.post("/api/agent/logout", { preHandler: authenticate }, async (request, reply) => {
    await repository.deleteSession(request.sessionDigest);
    reply.clearCookie(cookieName, { path: "/", httpOnly: true, sameSite: "strict", secure: production });
    return { ok: true };
  });

  app.get("/api/agent/me", { preHandler: authenticate }, async (request) => {
    const agents = request.agent.role === "admin" ? await repository.listAgents() : [];
    return { agent: sanitizeAgent(request.agent), agents: agents.map(sanitizeAgent) };
  });

  app.patch("/api/agent/profile", { preHandler: authenticate }, async (request) => {
    const input = request.body || {};
    const account = String(input.account || "").trim();
    const name = String(input.name || "").trim();
    const wechat = String(input.wechat || "").trim();
    const phone = String(input.phone || "").trim();
    const password = String(input.password || "");
    if (!account || !name || (request.agent.role === "staff" && !wechat)) throw domainError("PROFILE_FIELDS_REQUIRED", "请填写登录账号、中介名称和微信", 400);
    if (request.agent.mustChangePassword && password.length < 10) throw domainError("PASSWORD_CHANGE_REQUIRED", "首次登录请设置至少10位的新密码", 400);
    if (password && password.length < 10) throw domainError("PASSWORD_TOO_SHORT", "新密码至少需要10位", 400);
    const agent = await repository.updateAgentProfile(request.agent.id, {
      account, name, wechat, phone, passwordHash: password ? hashPassword(password) : null,
      currentSessionDigest: request.sessionDigest
    });
    return { agent: sanitizeAgent(agent), agents: request.agent.role === "admin" ? (await repository.listAgents()).map(sanitizeAgent) : [] };
  });

  app.post("/api/agent/agents", { preHandler: requireAdmin }, async (request, reply) => {
    const name = String(request.body?.name || "").trim();
    if (!name) throw domainError("AGENT_NAME_REQUIRED", "请填写中介名称", 400);
    const temporaryPassword = createTemporaryPassword();
    const agent = await repository.createAgent({
      name, wechat: String(request.body?.wechat || "").trim(), phone: String(request.body?.phone || "").trim(),
      passwordHash: hashPassword(temporaryPassword)
    }, request.agent);
    reply.code(201);
    return { agent: sanitizeAgent(agent), temporaryPassword };
  });

  app.patch("/api/agent/agents/:id/reset-password", { preHandler: requireAdmin }, async (request) => {
    const temporaryPassword = createTemporaryPassword();
    await repository.resetAgentPassword(request.params.id, hashPassword(temporaryPassword));
    return { temporaryPassword };
  });

  app.get("/api/agent/orders", { preHandler: requirePasswordChanged }, async (request) => {
    const query = request.query || {};
    return repository.listAgentOrders({ scope: query.scope || "working", status: query.status || "", keyword: query.keyword || "", page: query.page || 1 });
  });

  app.post("/api/agent/orders", { preHandler: requireStaff }, async (request, reply) => {
    const idempotencyKey = String(request.headers["idempotency-key"] || request.body?.idempotencyKey || "").trim();
    if (!idempotencyKey) throw domainError("IDEMPOTENCY_KEY_REQUIRED", "发布请求缺少幂等标识，请刷新后重试", 400);
    if (idempotencyKey.length > 200) throw domainError("IDEMPOTENCY_KEY_INVALID", "发布请求标识过长", 400);
    const order = await repository.createOrder({ ...(request.body || {}), idempotencyKey }, request.agent);
    reply.code(201);
    return { order };
  });

  app.patch("/api/agent/orders/:id", { preHandler: requireStaff }, async (request) => {
    requireVersion(request.body);
    const order = await repository.updateOrder(request.params.id, request.body, request.agent);
    return { order };
  });

  app.patch("/api/agent/orders/:id/status", { preHandler: requireStaff }, async (request) => {
    requireVersion(request.body);
    const order = await repository.transitionOrder(request.params.id, request.body, request.agent);
    return { order };
  });

  app.patch("/api/admin/orders/:id/correct", { preHandler: requireAdmin }, async (request) => {
    requireVersion(request.body);
    return { order: await repository.correctOrder(request.params.id, request.body, request.agent) };
  });

  app.post("/api/agent/import-batches", { preHandler: requireStaff }, async (request, reply) => {
    let sourceType = "text";
    let filename = "";
    let items;
    if (request.isMultipart()) {
      const file = await request.file();
      if (!file) throw domainError("IMPORT_FILE_REQUIRED", "请选择CSV或Excel文件", 400);
      filename = file.filename || "";
      const buffer = await file.toBuffer();
      const extension = path.extname(filename).toLowerCase();
      if (extension === ".csv") items = await parseCsvBuffer(buffer);
      else if (extension === ".xlsx") items = await parseSpreadsheetBuffer(buffer);
      else throw domainError("IMPORT_FILE_TYPE", "仅支持.csv和.xlsx文件", 400);
      sourceType = "spreadsheet";
    } else {
      const content = String(request.body?.content || "").trim();
      if (!content) throw domainError("IMPORT_EMPTY", "请粘贴微信订单文本", 400);
      items = parseTextItems(content);
    }
    const batch = await repository.createImportBatch({ sourceType, filename, items }, request.agent);
    reply.code(201);
    return { batch };
  });

  app.get("/api/agent/import-batches", { preHandler: requireStaff }, async () => {
    return { batches: await repository.listImportBatches() };
  });

  app.get("/api/agent/import-batches/:id/errors.csv", { preHandler: requireStaff }, async (request, reply) => {
    const items = await repository.listImportErrors(request.params.id);
    const rows = [["行号", "错误提示", "解析数据"], ...items.map((item) => [item.rowNumber, item.warnings.join("；"), JSON.stringify(item.parsedData)])];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="import-errors-${request.params.id}.csv"`);
    return csv;
  });

  app.get("/api/agent/import-batches/:id", { preHandler: requireStaff }, async (request) => {
    return repository.getImportBatch(request.params.id, request.query?.page || 1);
  });

  app.patch("/api/agent/import-items/:id", { preHandler: requireStaff }, async (request) => {
    requireVersion(request.body);
    return { item: await repository.updateImportItem(request.params.id, request.body, request.agent) };
  });

  app.post("/api/agent/import-batches/:id/publish", { preHandler: requireStaff }, async (request) => {
    return repository.publishImportBatch(request.params.id, request.agent);
  });

  if (serveFiles) {
    app.get("/", async (_request, reply) => reply.sendFile("teacher.html"));
    app.get("/teacher.html", async (_request, reply) => reply.sendFile("teacher.html"));
    app.get("/agent.html", async (_request, reply) => reply.sendFile("agent.html"));
    for (const file of ["app.js", "platform-core.js", "styles.css"]) app.get(`/${file}`, async (_request, reply) => reply.sendFile(file));
  }

  app.addHook("onClose", async () => repository.close?.());
  return app;
}

function arrayValue(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return value ? [String(value)] : [];
}

function requireVersion(body) {
  if (!Number.isInteger(Number(body?.version)) || Number(body.version) < 1) {
    throw domainError("VERSION_REQUIRED", "订单版本无效，请刷新后重试", 400);
  }
}

function createTemporaryPassword() {
  return crypto.randomBytes(12).toString("base64url");
}

function csvCell(value) {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

module.exports = { buildApp, createTemporaryPassword, csvCell, requireVersion, resolveAllowedOrigin, sanitizeAgent };
