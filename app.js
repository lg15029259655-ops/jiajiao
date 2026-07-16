const STORAGE_KEY = "simple_tutor_platform_v4";
const SESSION_KEY = "simple_tutor_agent_session";
const core = window.TutorCore;
const page = document.body.dataset.page;
const useApi = document.body.dataset.mode !== "demo";

const now = () => new Date().toISOString();

detectDevice();

const demoData = {
  agents: [
    { id: "admin_1", account: "demo-admin", name: "管理员", wechat: "", phone: "", password: "", role: "admin", active: true },
    { id: "agent_1", account: "demo-001", name: "中介A", wechat: "", phone: "", password: "", role: "staff", active: true },
    { id: "agent_2", account: "demo-002", name: "中介B", wechat: "", phone: "", password: "", role: "staff", active: true }
  ],
  orders: [
    {
      id: "order_seed_1",
      orderNo: "061456",
      studentGender: "女孩",
      grade: "初一",
      subject: "数学",
      score: "110/120",
      lessonTime: "每周1-2次，每次2小时，大概时间段周一到周四都可以。暑假继续，长期需要",
      price: "100元/小时",
      area: "莲湖区",
      address: "莲湖区北曹家巷小区9号院，暑假大概率在高陵上课",
      requirement: "女老师，初中数学经验丰富，数学成绩优异能力强，可以带培优拔高的学生，攻克难题",
      parentName: "李女士",
      parentPhone: "",
      parentWechat: "",
      internalNote: "演示订单，可在后台搜索原始文本和备注。",
      rawText: "061456 女孩 初一 数学 110/120 莲湖区北曹家巷小区9号院，100元/小时",
      agentId: "agent_1",
      status: "active",
      createdAt: now(),
      updatedAt: now(),
      logs: []
    },
    {
      id: "order_seed_2",
      orderNo: "061420",
      studentGender: "男孩",
      grade: "初一",
      subject: "数学",
      score: "预科",
      lessonTime: "暑假预计15次，每次2小时，七月初开始。秋季开学每周末一次",
      price: "100元/小时",
      area: "高新区",
      address: "高新区科技六路天地源枫林意树小区",
      requirement: "男老师，初中数学辅导经验丰富，注重思维能力培养，985院校优先，不要大一",
      parentName: "",
      parentPhone: "",
      parentWechat: "",
      internalNote: "",
      rawText: "初一男生数学，预科，高新区科技六路天地源枫林意树小区，暑假预计15次。",
      agentId: "agent_1",
      status: "active",
      createdAt: now(),
      updatedAt: now(),
      logs: []
    },
    {
      id: "order_seed_3",
      orderNo: "062210",
      studentGender: "男孩",
      grade: "高三",
      subject: "化学",
      score: "未说明",
      lessonTime: "长期课，每周4-5次，每次2小时，具体时间可协商，近期开课",
      price: "130元/小时",
      area: "碑林区",
      address: "碑林区边家村东泰城市之光",
      requirement: "男老师，有经验，性格开朗，化学能力强，能稳定带课，交大优先",
      parentName: "",
      parentPhone: "",
      parentWechat: "",
      internalNote: "",
      rawText: "高三男生化学，碑林区边家村东泰城市之光，130元/小时。",
      agentId: "agent_2",
      status: "active",
      createdAt: now(),
      updatedAt: now(),
      logs: []
    },
    ...createExtraDemoOrders(20)
  ],
  backups: []
};

function createExtraDemoOrders(count) {
  const grades = ["一年级", "三年级", "五年级", "初一", "初二", "初三", "高一", "高二", "高三"];
  const subjects = ["语文", "数学", "英语", "物理", "化学", "生物", "历史", "地理", "政治"];
  const areas = ["雁塔区", "碑林区", "莲湖区", "高新区", "长安区", "未央区", "线上"];
  return Array.from({ length: count }, (_, index) => {
    const orderNo = String(700001 + index);
    const grade = grades[index % grades.length];
    const subject = subjects[index % subjects.length];
    const area = areas[index % areas.length];
    return {
      id: `order_extra_${index + 1}`,
      orderNo,
      studentGender: index % 2 === 0 ? "女孩" : "男孩",
      grade,
      subject,
      score: index % 3 === 0 ? "基础一般" : index % 3 === 1 ? "80分左右" : "需要拔高",
      lessonTime: index % 2 === 0 ? "每周2次，每次2小时，周末优先" : "每周1次，每次2小时，时间可协商",
      price: index % 2 === 0 ? "100元/小时" : "120元/小时",
      area,
      address: area === "线上" ? "线上上课" : `${area}演示小区${index + 1}号楼`,
      requirement: index % 2 === 0 ? "有相关科目辅导经验，沟通耐心" : "成绩优秀，有方法，能长期稳定带课",
      parentName: "",
      parentPhone: "",
      parentWechat: "",
      internalNote: "分页演示订单",
      rawText: `${grade}${subject}，${area}，每周补习，报价${index % 2 === 0 ? "100元/小时" : "120元/小时"}`,
      agentId: index % 2 === 0 ? "agent_1" : "agent_2",
      status: "active",
      createdAt: now(),
      updatedAt: now(),
      logs: []
    };
  });
}

let state = useApi ? { agents: [], orders: [], backups: [] } : loadState();
let teacherPage = 1;
let staffPage = 1;
let reviewPage = 1;
let agentInitialized = false;
let currentAgent = null;
let activeImportBatchId = null;
const visibleOrders = new Map();
let teacherRenderToken = 0;
let staffRenderToken = 0;
let reviewRenderToken = 0;

const teacherSelections = {
  grade: new Set(),
  subject: new Set(),
  area: new Set()
};

if (page === "teacher") initTeacherPage();
if (page === "agent") initAgentPage();

function detectDevice() {
  const apply = () => {
    const mobileWidth = window.innerWidth < 980;
    const touchDevice = navigator.maxTouchPoints > 0;
    const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    document.documentElement.dataset.device = mobileWidth && (touchDevice || mobileUserAgent) ? "mobile" : "desktop";
  };
  apply();
  window.addEventListener("resize", apply);
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || payload.error || "操作失败");
    error.code = payload.error?.code || "REQUEST_FAILED";
    throw error;
  }
  return payload;
}

function initTeacherPage() {
  fillFilterMenu("#teacherGradeOptions", "grade", core.FILTERS.grades);
  fillFilterMenu("#teacherSubjectOptions", "subject", core.FILTERS.subjects);
  fillFilterMenu("#teacherAreaOptions", "area", core.FILTERS.areas);
  document.querySelectorAll("[data-filter-toggle]").forEach((button) => {
    button.addEventListener("click", () => toggleFilterMenu(button.dataset.filterToggle));
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".filter-menu")) closeFilterMenus();
  });
  document.querySelector("#teacherSearch").addEventListener("input", () => {
    teacherPage = 1;
    renderTeacher();
  });
  if (!useApi) {
    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_KEY) return;
      state = loadState();
      renderTeacher();
    });
  }
  renderTeacher();
}

async function initAgentPage() {
  document.querySelector("#loginForm").addEventListener("submit", loginAgent);
  if (useApi) {
    try {
      const payload = await apiJson("/api/agent/me");
      currentAgent = payload.agent;
      state.agents = payload.agents?.length ? payload.agents : [payload.agent];
    } catch {
      currentAgent = null;
    }
  } else {
    const sessionId = localStorage.getItem(SESSION_KEY);
    currentAgent = state.agents.find((agent) => agent.id === sessionId && agent.active);
  }
  updateAuthView();
}

function initAgentWorkspace() {
  if (agentInitialized) return;
  agentInitialized = true;

  fillDatalist("#gradeOptions", core.FILTERS.grades);
  fillDatalist("#subjectOptions", core.FILTERS.subjects);
  fillDatalist("#areaOptions", core.FILTERS.areas);
  renderAgentOptions();
  renderAgentList();
  renderStaff();

  document.querySelectorAll("[data-agent-tab]").forEach((button) => {
    button.addEventListener("click", () => activateAgentTab(button.dataset.agentTab));
  });
  document.querySelector("#parseBtn").addEventListener("click", () => {
    const parsed = core.parseOrderText(document.querySelector("#rawText").value);
    fillOrderForm(parsed);
    showParseReview(parsed);
    showToast("识别完成，请核对标红字段后再发布");
  });
  document.querySelector("#clearFormBtn").addEventListener("click", resetOrderForm);
  document.querySelector("#batchImportBtn").addEventListener("click", importBatchToReview);
  document.querySelector("#batchImportFile").addEventListener("change", importFileToReview);
  document.querySelector("#publishReadyBtn").addEventListener("click", publishReadyReviewOrders);
  document.querySelector("#exportImportErrorsBtn").addEventListener("click", () => {
    if (!activeImportBatchId) return showToast("暂无导入批次");
    window.location.href = `/api/agent/import-batches/${encodeURIComponent(activeImportBatchId)}/errors.csv`;
  });
  document.querySelector("#exportBtn")?.addEventListener("click", exportData);
  document.querySelector("#resetBtn")?.addEventListener("click", resetDemoData);
  document.querySelector("#importInput")?.addEventListener("change", importData);
  document.querySelector("#logoutBtn").addEventListener("click", logoutAgent);
  document.querySelector("#orderForm").addEventListener("submit", submitOrder);
  document.querySelector("#orderForm").addEventListener("input", (event) => {
    if (event.target.value?.trim()) event.target.classList.remove("needs-review");
  });
  document.querySelector("#profileForm").addEventListener("submit", submitProfile);
  document.querySelector("#agentForm").addEventListener("submit", submitAgent);
  ["#staffSearch", "#staffScope", "#staffStatus"].forEach((selector) => {
    document.querySelector(selector).addEventListener("input", resetStaffPage);
    document.querySelector(selector).addEventListener("change", resetStaffPage);
  });
  ["#reviewSearch", "#reviewStatus"].forEach((selector) => {
    document.querySelector(selector)?.addEventListener("input", resetReviewPage);
    document.querySelector(selector)?.addEventListener("change", resetReviewPage);
  });
}

async function loginAgent(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const account = String(form.get("account") || "").trim();
  const password = String(form.get("password") || "").trim();
  if (useApi) {
    try {
      const payload = await apiJson("/api/agent/login", { method: "POST", body: { account, password } });
      currentAgent = payload.agent;
      const me = await apiJson("/api/agent/me");
      state.agents = me.agents?.length ? me.agents : [me.agent];
    } catch (error) {
      return showToast(error.message);
    }
  } else {
    const agent = state.agents.find((item) => {
      const loginNames = [item.account, item.phone, item.wechat].filter(Boolean);
      return loginNames.includes(account) && item.password === password && item.active;
    });
    if (!agent) return showToast("账号或密码不正确");
    currentAgent = agent;
    localStorage.setItem(SESSION_KEY, agent.id);
  }
  formElement.reset();
  updateAuthView();
  showToast("已登录中介后台");
}

async function logoutAgent() {
  if (useApi) await apiJson("/api/agent/logout", { method: "POST" }).catch(() => {});
  else localStorage.removeItem(SESSION_KEY);
  currentAgent = null;
  updateAuthView();
}

function updateAuthView() {
  const loggedIn = Boolean(currentAgent);
  document.querySelector("#loginPanel").classList.toggle("hidden", loggedIn);
  document.querySelector("#agentWorkspace").classList.toggle("hidden", !loggedIn);
  if (loggedIn) {
    initAgentWorkspace();
    document.querySelector("#currentAccount").textContent = `当前账号：${currentAgent.name}（${currentAgent.account}）`;
    applyRoleView();
    fillProfileForm();
    renderAgentOptions();
    renderAgentList();
    renderStaff();
  }
}

function applyRoleView() {
  const canEnter = core.canEnterOrders(currentAgent) && !currentAgent.mustChangePassword;
  document.querySelector('[data-agent-tab="entry"]').classList.toggle("hidden", !canEnter);
  document.querySelector('[data-agent-page="entry"]').classList.toggle("hidden", !canEnter);
  document.querySelector("#adminAccountPanel").classList.toggle("hidden", !core.canManageAgents(currentAgent));
  if (!canEnter && document.querySelector('[data-agent-tab="entry"]').classList.contains("active")) {
    activateAgentTab("manage");
  }
  document.querySelector('[data-agent-tab="review"]').classList.toggle("hidden", !canEnter);
  document.querySelector('[data-agent-page="review"]').classList.toggle("hidden", !canEnter);
  if (currentAgent.mustChangePassword) {
    activateAgentTab("account");
    showToast("首次登录请先设置至少10位的新密码");
  }
}

function activateAgentTab(tabName) {
  document.querySelectorAll("[data-agent-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.agentTab === tabName);
  });
  document.querySelectorAll("[data-agent-page]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.agentPage === tabName);
  });
  if (tabName === "manage") renderStaff();
  if (tabName === "review") renderReview();
}

async function renderTeacher() {
  const renderToken = ++teacherRenderToken;
  const filters = {
    grades: [...teacherSelections.grade],
    subjects: [...teacherSelections.subject],
    areas: [...teacherSelections.area],
    keyword: document.querySelector("#teacherSearch").value.trim(),
    page: teacherPage
  };
  const list = document.querySelector("#teacherList");
  list.innerHTML = loadingCards(2);
  let result;
  try {
    result = useApi
      ? await apiJson(`/api/teacher/orders?${teacherQuery(filters)}`)
      : core.queryTeacherOrders(enrichedOrders(), filters);
  } catch (error) {
    if (renderToken !== teacherRenderToken) return;
    list.innerHTML = retryState("订单加载失败", error.message, "teacher");
    bindRetryButton(list, renderTeacher);
    return;
  }
  if (renderToken !== teacherRenderToken) return;
  teacherPage = result.page;
  document.querySelector("#teacherList").innerHTML = result.items.map((order) => teacherCard(order)).join("");
  document.querySelector("#teacherEmpty").classList.toggle("hidden", result.totalItems > 0);
  renderPagination("#teacherPagination", result, (pageNumber) => {
    teacherPage = pageNumber;
    renderTeacher();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  renderChips(filters);
  bindCopyButtons(document.querySelector("#teacherList"));
}

function teacherQuery(filters) {
  const params = new URLSearchParams();
  filters.grades.forEach((value) => params.append("grade", value));
  filters.subjects.forEach((value) => params.append("subject", value));
  filters.areas.forEach((value) => params.append("area", value));
  if (filters.keyword) params.set("keyword", filters.keyword);
  params.set("page", String(filters.page || 1));
  return params.toString();
}

async function renderStaff() {
  if (!currentAgent) return;
  const renderToken = ++staffRenderToken;
  const options = {
    keyword: document.querySelector("#staffSearch").value.trim(),
    status: document.querySelector("#staffStatus").value,
    page: staffPage,
    scope: document.querySelector("#staffScope")?.value === "history" ? "history" : "working"
  };
  const list = document.querySelector("#staffList");
  list.innerHTML = loadingCards(2);
  let result;
  try {
    result = useApi ? await apiJson(`/api/agent/orders?${staffQuery(options)}`) : (
      options.scope === "history" ? core.queryArchivedOrders(enrichedOrders(), options) : core.queryStaffOrders(enrichedOrders(), options)
    );
  } catch (error) {
    if (renderToken !== staffRenderToken) return;
    list.innerHTML = retryState("订单加载失败", error.message, "staff");
    bindRetryButton(list, renderStaff);
    return;
  }
  if (renderToken !== staffRenderToken) return;
  visibleOrders.clear();
  result.items.forEach((order) => visibleOrders.set(order.id, order));
  staffPage = result.page;
  const counts = result.counts || countStatuses();
  const workingTotal = (counts.active || 0) + (counts.paused || 0);
  const archiveTotal = (counts.completed || 0) + (counts.cancelled || 0) + (counts.deleted || 0);
  document.querySelector("#staffStats").textContent = `处理中 ${workingTotal} 单，历史 ${archiveTotal} 单，招募中 ${counts.active || 0}，锁单沟通 ${counts.paused || 0}`;
  document.querySelector("#staffList").innerHTML = result.items.map((order) => staffCard(order)).join("");
  document.querySelector("#staffEmpty").classList.toggle("hidden", result.totalItems > 0);
  renderPagination("#staffPagination", result, (pageNumber) => {
    staffPage = pageNumber;
    renderStaff();
  });
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => updateOrderStatus(button.dataset.id, button.dataset.action));
  });
  document.querySelectorAll("[data-edit-order]").forEach((button) => {
    button.addEventListener("click", () => openOrderEditor(visibleOrders.get(button.dataset.editOrder)));
  });
  document.querySelectorAll("[data-admin-correct]").forEach((button) => {
    button.addEventListener("click", () => openAdminCorrection(visibleOrders.get(button.dataset.adminCorrect)));
  });
  bindCopyButtons(document.querySelector("#staffList"));
}

function staffQuery(options) {
  const params = new URLSearchParams();
  if (options.keyword) params.set("keyword", options.keyword);
  if (options.status) params.set("status", options.status);
  params.set("scope", options.scope || "working");
  params.set("page", String(options.page || 1));
  return params.toString();
}

function resetStaffPage() {
  staffPage = 1;
  renderStaff();
}

async function renderReview() {
  if (!currentAgent || !core.canEnterOrders(currentAgent)) return;
  const renderToken = ++reviewRenderToken;
  const list = document.querySelector("#reviewList");
  list.innerHTML = loadingCards(2);
  let result;
  try {
    if (!activeImportBatchId) {
      const recent = await apiJson("/api/agent/import-batches");
      activeImportBatchId = recent.batches?.[0]?.id || null;
    }
    if (!activeImportBatchId) {
      result = { items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1 };
    } else {
      result = await apiJson(`/api/agent/import-batches/${encodeURIComponent(activeImportBatchId)}?page=${reviewPage}`);
    }
  } catch (error) {
    if (renderToken !== reviewRenderToken) return;
    list.innerHTML = retryState("待审核数据加载失败", error.message, "review");
    bindRetryButton(list, renderReview);
    return;
  }
  if (renderToken !== reviewRenderToken) return;
  reviewPage = result.page;
  const ready = result.items.filter((order) => order.reviewStatus === "ready").length;
  const needs = result.items.filter((order) => order.reviewStatus === "needs_review").length;
  document.querySelector("#reviewStats").textContent = `本页可发布 ${ready} 条，需要处理 ${needs} 条`;
  document.querySelector("#reviewList").innerHTML = result.items.map((item) => reviewCard({ id: item.id, version: item.version, ...item.parsedData, reviewStatus: item.reviewStatus, importWarnings: item.warnings })).join("");
  document.querySelectorAll("[data-edit-import]").forEach((button) => {
    button.addEventListener("click", () => openImportItemEditor(result.items.find((item) => item.id === button.dataset.editImport)));
  });
  document.querySelector("#reviewEmpty").classList.toggle("hidden", result.totalItems > 0);
  renderPagination("#reviewPagination", result, (pageNumber) => {
    reviewPage = pageNumber;
    renderReview();
  });
}

function reviewQuery(options) {
  const params = new URLSearchParams();
  if (options.keyword) params.set("keyword", options.keyword);
  if (options.reviewStatus) params.set("reviewStatus", options.reviewStatus);
  params.set("page", String(options.page || 1));
  return params.toString();
}

function resetReviewPage() {
  reviewPage = 1;
  renderReview();
}

function reviewCard(order) {
  const warnings = order.importWarnings || [];
  return `
    <article class="order-card ${escapeAttr(order.reviewStatus || "needs_review")}">
      <div class="card-head">
        <h2>${escapeHtml(order.orderNo || "待生成订单号")}</h2>
        <span class="status ${escapeAttr(order.reviewStatus)}">${order.reviewStatus === "ready" ? "可批量发布" : "需要处理"}</span>
      </div>
      ${infoRows([...publicRows(order), ...privateRows(order)])}
      ${warnings.length ? `<div class="parse-review">${warnings.map(escapeHtml).join("；")}</div>` : `<div class="parse-review success">字段完整，未发现明显重复，可批量发布。</div>`}
      <div class="actions"><button class="subtle" data-edit-import="${escapeAttr(order.id)}">编辑审核项</button></div>
    </article>
  `;
}

function openImportItemEditor(item) {
  if (!item) return;
  const data = item.parsedData || {};
  const fields = [["orderNo", "订单号"], ["studentGender", "学生性别"], ["grade", "年级"], ["subject", "科目"],
    ["area", "区域"], ["score", "当前成绩"], ["lessonTime", "补习时间"], ["price", "报价"], ["address", "地址"],
    ["requirement", "老师要求"], ["parentPhone", "家长电话"], ["parentWechat", "家长微信"]];
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  backdrop.innerHTML = `<section class="dialog-panel order-editor" role="dialog" aria-modal="true">
    <h2>编辑第 ${item.rowNumber} 行</h2><form class="form">
      ${fields.map(([name, label]) => `<label><span>${label}</span><input name="${name}" value="${escapeAttr(data[name] || "")}"></label>`).join("")}
      ${item.warnings?.length ? `<label class="wide duplicate-check"><input type="checkbox" name="duplicateConfirmed"><span>我已核对疑似重复提示，确认仍要发布</span></label>` : ""}
      <div class="dialog-actions wide"><button type="button" data-editor-cancel>取消</button><button class="primary" type="submit">保存审核</button></div>
    </form></section>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector("[data-editor-cancel]").addEventListener("click", () => backdrop.remove());
  backdrop.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submitButton = event.submitter;
    const parsedData = Object.fromEntries(fields.map(([name]) => [name, String(form.get(name) || "").trim()]));
    submitButton.disabled = true;
    try {
      await apiJson(`/api/agent/import-items/${encodeURIComponent(item.id)}`, {
        method: "PATCH", body: { version: item.version, parsedData, duplicateConfirmed: form.get("duplicateConfirmed") === "on" }
      });
      backdrop.remove();
      await renderReview();
      showToast("审核项已保存");
    } catch (error) {
      showToast(error.message);
      submitButton.disabled = false;
    }
  });
}

async function importBatchToReview() {
  const content = document.querySelector("#batchImportText").value.trim();
  if (!content) return showToast("请先粘贴要导入的订单文本");
  if (!await askConfirm("确认导入到待审核？", "系统会自动识别字段，完整订单可批量发布，异常订单会标记需要处理。")) return;
  try {
    const payload = await apiJson("/api/agent/import-batches", { method: "POST", body: { sourceType: "text", content } });
    activeImportBatchId = payload.batch.id;
    document.querySelector("#batchImportText").value = "";
    reviewPage = 1;
    activateAgentTab("review");
    renderReview();
    showToast(`已导入 ${payload.batch.totalCount} 条，${payload.batch.readyCount} 条可批量发布`);
  } catch (error) {
    showToast(error.message);
  }
}

async function importFileToReview(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    event.target.value = "";
    return showToast("文件不能超过10 MB");
  }
  if (!await askConfirm("确认导入表格到待审核？", "表格内容只会进入审核区，不会直接发布到老师大厅。")) return;
  const data = new FormData();
  data.append("file", file);
  try {
    const response = await fetch("/api/agent/import-batches", { method: "POST", credentials: "same-origin", body: data });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || "文件导入失败");
    activeImportBatchId = payload.batch.id;
    event.target.value = "";
    reviewPage = 1;
    activateAgentTab("review");
    showToast(`已导入 ${payload.batch.totalCount} 条，请先审核再发布`);
  } catch (error) {
    showToast(error.message);
  }
}

async function publishReadyReviewOrders() {
  if (!await askConfirm("确认发布所有可通过订单？", "只有字段完整且未发现明显重复的订单会进入老师大厅。")) return;
  try {
    if (!activeImportBatchId) return showToast("暂无可发布的导入批次");
    const payload = await apiJson(`/api/agent/import-batches/${encodeURIComponent(activeImportBatchId)}/publish`, { method: "POST", body: {} });
    renderReview();
    renderStaff();
    showToast(`已发布 ${payload.publishedCount} 条订单，跳过 ${payload.skippedCount} 条`);
  } catch (error) {
    showToast(error.message);
  }
}

function teacherCard(order) {
  return `
    <article class="order-card public-card">
      <div class="card-head teacher-card-head">
        <div class="order-title">
          <span>订单编号</span>
          <h2>${escapeHtml(order.orderNo)}</h2>
        </div>
        <button class="text-copy" data-copy="${escapeAttr(orderAgentText(order))}">复制订单号和中介微信</button>
      </div>
      <div class="teacher-summary">
        <span>${escapeHtml(order.grade || "年级未填")}</span>
        <span>${escapeHtml(order.subject || "科目未填")}</span>
        <span>${escapeHtml(order.area || "区域未填")}</span>
        <strong>${escapeHtml(order.price || "报价未填")}</strong>
      </div>
      <div class="teacher-card-actions">
        <button class="address-copy" data-copy="${escapeAttr(order.address)}">⌖ 复制地址</button>
      </div>
      <p class="update-note">更新：${escapeHtml(relativeTime(order.updatedAt || order.createdAt))}</p>
      ${teacherInfoRows(order)}
    </article>
  `;
}

function staffCard(order) {
  return `
    <article class="order-card ${escapeAttr(order.status)}">
      <div class="card-head">
        <h2>订单 ${escapeHtml(order.orderNo)}</h2>
        <button class="text-copy" data-copy="${escapeAttr(order.orderNo)}">复制订单号</button>
        <span class="status ${escapeAttr(order.status)}">${escapeHtml(core.STATUS_TEXT[order.status])}</span>
      </div>
      ${infoRows([...publicRows(order), ...privateRows(order)])}
      ${staffActions(order)}
      ${logList(order)}
    </article>
  `;
}

function publicRows(order) {
  return [
    ["学生性别", order.studentGender],
    ["学生年级", order.grade],
    ["补习科目", order.subject],
    ["现阶段成绩", order.score || "未说明"],
    ["补习时间", order.lessonTime],
    ["报价", order.price],
    ["地址", order.address],
    ["对老师要求", order.requirement || "未说明"]
  ];
}

function privateRows(order) {
  return [
    ["区域", order.area || "未填写"],
    ["中介微信", `${order.agentName || "未分配"} ${order.agentWechat || ""}`.trim()],
    ["家长称呼", order.parentName || "未填写"],
    ["家长电话", order.parentPhone || "未填写"],
    ["家长微信", order.parentWechat || "未填写"],
    ["内部备注", order.internalNote || "无"],
    ...(order.assignedTeacherContact ? [["接单老师联系方式", order.assignedTeacherContact]] : []),
    ["原始文本", order.rawText || "无"]
  ];
}

function infoRows(rows) {
  return `<dl class="info">${rows.map(([label, value]) => `<dt>【${escapeHtml(label)}】</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>`;
}

function teacherInfoRows(order) {
  const rows = [
    ["学生", `${order.studentGender || "未说明"} · ${order.score || "成绩未说明"}`],
    ["时间", order.lessonTime || "未说明"],
    ["地址", order.address || "未说明"],
    ["要求", order.requirement || "未说明"]
  ];
  return `<dl class="info teacher-detail-list">${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>`;
}

function staffActions(order) {
  if (currentAgent?.role === "admin") {
    return `<div class="actions"><button class="subtle" data-admin-correct="${escapeAttr(order.id)}">特殊纠错</button></div>`;
  }
  const actions = core.STAFF_ACTIONS[order.status] || [];
  const edit = ["active", "paused"].includes(order.status)
    ? `<button class="subtle" data-edit-order="${escapeAttr(order.id)}">编辑订单</button>` : "";
  const readOnly = ["completed", "cancelled", "deleted"].includes(order.status)
    ? `<span class="readonly-note">历史订单只读</span>` : "";
  return `<div class="actions">${edit}${actions.map((action) => (
    `<button class="${escapeAttr(action.tone)}" data-action="${escapeAttr(action.status)}" data-id="${escapeAttr(order.id)}">${escapeHtml(action.label)}</button>`
  )).join("")}${readOnly}</div>`;
}

function openAdminCorrection(order) {
  if (!order || currentAgent?.role !== "admin") return;
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  backdrop.innerHTML = `<section class="dialog-panel" role="dialog" aria-modal="true">
    <h2>管理员特殊纠错：${escapeHtml(order.orderNo)}</h2>
    <p>此操作会写入永久审计记录，不用于日常订单处理。</p>
    <form class="form compact-form">
      <select name="status" required>
        ${["active", "paused", "completed", "cancelled", "deleted"].map((status) => `<option value="${status}" ${status === order.status ? "selected" : ""}>${escapeHtml(core.STATUS_TEXT[status])}</option>`).join("")}
      </select>
      <input name="assignedTeacherContact" value="${escapeAttr(order.assignedTeacherContact || "")}" placeholder="锁单时填写老师联系方式">
      <input name="reason" required placeholder="纠错原因">
      <div class="dialog-actions"><button type="button" data-editor-cancel>取消</button><button class="primary" type="submit">确认纠错</button></div>
    </form>
  </section>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector("[data-editor-cancel]").addEventListener("click", () => backdrop.remove());
  backdrop.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const button = event.submitter;
    button.disabled = true;
    try {
      await apiJson(`/api/admin/orders/${encodeURIComponent(order.id)}/correct`, { method: "PATCH", body: { ...data, version: order.version } });
      backdrop.remove();
      await renderStaff();
      showToast("特殊纠错已保存并记录审计日志");
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
    }
  });
}

async function submitOrder(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const initialSubmitButton = event.submitter || formElement.querySelector('[type="submit"]');
  if (!core.canEnterOrders(currentAgent)) return showToast("管理员不能录入订单");
  const form = new FormData(formElement);
  const rawText = document.querySelector("#rawText").value.trim();
  const agentId = String(form.get("agentId") || currentAgent.id || "").trim();
  const orderNo = String(form.get("orderNo") || "").trim() || (useApi ? "" : core.nextOrderNo(state.orders));
  const order = normalizeOrder({
    id: `order_${Date.now()}`,
    orderNo,
    studentGender: String(form.get("studentGender") || "未说明").trim(),
    grade: String(form.get("grade") || "").trim(),
    subject: String(form.get("subject") || "").trim(),
    area: String(form.get("area") || "").trim(),
    score: String(form.get("score") || "").trim(),
    lessonTime: String(form.get("lessonTime") || "").trim(),
    price: String(form.get("price") || "").trim(),
    address: String(form.get("address") || "").trim(),
    requirement: String(form.get("requirement") || "").trim(),
    parentName: String(form.get("parentName") || "").trim(),
    parentPhone: String(form.get("parentPhone") || "").trim(),
    parentWechat: String(form.get("parentWechat") || "").trim(),
    internalNote: String(form.get("internalNote") || "").trim(),
    rawText,
    agentId,
    status: "active",
    createdAt: now(),
    updatedAt: now(),
    logs: []
  });
  const missing = requiredFields(order);
  if (missing.length) return showToast(`请补全：${missing.join("、")}`);
  const qualityWarnings = validateOrderQuality(order);
  if (qualityWarnings.length && !await askConfirm("订单信息格式提醒", `${qualityWarnings.join("\n")}\n\n仍然继续发布吗？`)) return;
  if (!useApi && state.orders.some((item) => item.orderNo === order.orderNo && item.status !== "deleted")) {
    return alert("订单号已存在，请修改后再发布。");
  }
  if (!await askConfirm("确认发布到老师订单大厅？", `订单 ${order.orderNo || "自动生成"} 发布后，老师端将可以看到并联系中介。`)) return;
  const warnings = core.findDuplicateWarnings(order, state.orders);
  if (warnings.length && !await askConfirm("可能存在相似订单", `${warnings.join("\n")}\n\n请确认是否继续发布？`)) return;
  if (useApi) {
    const submitButton = initialSubmitButton;
    const requestKey = crypto.randomUUID();
    submitButton.disabled = true;
    try {
      await apiJson("/api/agent/orders", {
        method: "POST",
        headers: { "idempotency-key": requestKey },
        body: order
      });
    } catch (error) {
      if (error.code !== "ORDER_DUPLICATE_SUSPECTED" || !await askConfirm("发现疑似重复订单", `${error.message}\n\n确认仍要继续发布吗？`)) {
        return showToast(error.message);
      }
      try {
        await apiJson("/api/agent/orders", {
          method: "POST", headers: { "idempotency-key": requestKey }, body: { ...order, duplicateConfirmed: true }
        });
      } catch (retryError) {
        return showToast(retryError.message);
      }
    } finally {
      submitButton.disabled = false;
    }
  } else {
    addLog(order, "发布订单", "订单进入老师大厅", currentAgent.name);
    state.orders = [order, ...state.orders];
    saveState();
  }
  resetOrderForm();
  staffPage = 1;
  renderStaff();
  activateAgentTab("manage");
  showToast("订单已发布到老师大厅");
}

function validateOrderQuality(order) {
  const warnings = [];
  if (order.parentPhone && !/^1\d{10}$/.test(order.parentPhone)) warnings.push("家长电话不像 11 位手机号，请核对。");
  if (order.parentWechat && !/^[a-zA-Z][-_a-zA-Z0-9]{5,19}$/.test(order.parentWechat)) warnings.push("家长微信格式可能不标准，请核对。");
  if (order.price && !/(元|块|\/|每|小时|时|h|H)/.test(order.price)) warnings.push("报价缺少单位，例如 100元/小时。");
  return warnings;
}

async function updateOrderStatus(id, nextStatus) {
  const order = useApi ? visibleOrders.get(id) : state.orders.find((item) => item.id === id);
  if (!order) return;
  const confirmText = statusConfirmText(order, nextStatus);
  if (!await askConfirm(confirmText.title, confirmText.message)) return;
  let teacherContact = order.assignedTeacherContact || "";
  if (nextStatus === "paused") {
    teacherContact = await askText("填写接单老师联系方式", "请输入交信息费/接单老师的微信或手机号：", teacherContact);
    if (!teacherContact?.trim()) return showToast("暂时下架必须填写老师联系方式");
  }
  const reason = await askReason(nextStatus);
  if (!reason) return;
  if (useApi) {
    const actionButtons = [...document.querySelectorAll(`[data-id="${CSS.escape(id)}"]`)];
    actionButtons.forEach((button) => { button.disabled = true; });
    try {
      await apiJson(`/api/agent/orders/${encodeURIComponent(id)}/status`, {
        method: "PATCH",
        body: { status: nextStatus, reason, assignedTeacherContact: teacherContact.trim(), version: order.version }
      });
    } catch (error) {
      return showToast(error.message);
    } finally {
      actionButtons.forEach((button) => { button.disabled = false; });
    }
  } else {
    if (nextStatus === "paused") order.assignedTeacherContact = teacherContact.trim();
    order.status = nextStatus;
    order.updatedAt = now();
    addLog(order, core.STATUS_TEXT[nextStatus], reason, currentAgent.name);
    saveState();
  }
  renderStaff();
  showToast(`订单已更新为：${core.STATUS_TEXT[nextStatus]}`);
}

function statusConfirmText(order, nextStatus) {
  if (nextStatus === "paused") {
    return {
      title: `确认暂时下架订单 ${order.orderNo}？`,
      message: "下架后老师端不再展示该订单，中介端仍可搜索和恢复。"
    };
  }
  if (nextStatus === "cancelled") {
    return {
      title: `确认将订单 ${order.orderNo} 标记为家长取消？`,
      message: "该订单会进入历史归档，不再出现在老师端。"
    };
  }
  if (nextStatus === "deleted") {
    return {
      title: `确认删除订单 ${order.orderNo}？`,
      message: "删除后该订单会从普通工作台隐藏，请谨慎操作。"
    };
  }
  if (nextStatus === "completed") {
    return {
      title: `确认将订单 ${order.orderNo} 标记为试课成功？`,
      message: "该订单会从普通工作台隐藏。"
    };
  }
  if (nextStatus === "active") {
    return {
      title: `确认恢复订单 ${order.orderNo} 到老师大厅？`,
      message: "恢复后老师端将重新展示该订单。"
    };
  }
  return {
    title: `确认将订单 ${order.orderNo} 改为“${core.STATUS_TEXT[nextStatus] || nextStatus}”？`,
    message: ""
  };
}

async function askReason(nextStatus) {
  const options = core.REASON_OPTIONS[nextStatus] || ["其他"];
  const picked = await askText("填写操作原因", `请选择或填写原因：\n${options.join("、")}`, options[0]);
  return picked ? picked.trim() : "";
}

function askConfirm(title, message) {
  return openDialog({ title, message, mode: "confirm" });
}

function askText(title, message, defaultValue = "") {
  return openDialog({ title, message, mode: "text", defaultValue });
}

function openDialog({ title, message, mode, defaultValue = "" }) {
  const dialog = ensureDialog();
  const titleEl = dialog.querySelector("[data-dialog-title]");
  const messageEl = dialog.querySelector("[data-dialog-message]");
  const input = dialog.querySelector("[data-dialog-input]");
  const cancelButton = dialog.querySelector("[data-dialog-cancel]");
  const okButton = dialog.querySelector("[data-dialog-ok]");

  titleEl.textContent = title;
  messageEl.textContent = message || "";
  input.value = defaultValue || "";
  input.classList.toggle("hidden", mode !== "text");
  dialog.classList.remove("hidden");
  okButton.focus();
  if (mode === "text") input.focus();

  return new Promise((resolve) => {
    const close = (value) => {
      dialog.classList.add("hidden");
      cancelButton.removeEventListener("click", onCancel);
      okButton.removeEventListener("click", onOk);
      dialog.removeEventListener("keydown", onKeydown);
      resolve(value);
    };
    const onCancel = () => close(mode === "text" ? "" : false);
    const onOk = () => close(mode === "text" ? input.value.trim() : true);
    const onKeydown = (event) => {
      if (event.key === "Escape") onCancel();
      if (event.key === "Enter" && (mode !== "text" || document.activeElement === input)) onOk();
    };

    cancelButton.addEventListener("click", onCancel);
    okButton.addEventListener("click", onOk);
    dialog.addEventListener("keydown", onKeydown);
  });
}

function ensureDialog() {
  let dialog = document.querySelector("#appDialog");
  if (dialog) return dialog;
  dialog = document.createElement("div");
  dialog.id = "appDialog";
  dialog.className = "dialog-backdrop hidden";
  dialog.innerHTML = `
    <section class="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="dialogTitle">
      <h2 id="dialogTitle" data-dialog-title></h2>
      <p data-dialog-message></p>
      <input data-dialog-input class="hidden" />
      <div class="dialog-actions">
        <button type="button" data-dialog-cancel>取消</button>
        <button type="button" class="primary" data-dialog-ok>确认</button>
      </div>
    </section>
  `;
  document.body.appendChild(dialog);
  return dialog;
}

function fillOrderForm(parsed) {
  const form = document.querySelector("#orderForm");
  Object.entries(parsed).forEach(([key, value]) => {
    const field = form.elements[key];
    if (field && value) field.value = value;
  });
}

function showParseReview(parsed) {
  const missing = requiredFields(parsed);
  document.querySelector("#parseReview").classList.remove("hidden", "success");
  document.querySelector("#parseReview").classList.toggle("success", missing.length === 0);
  document.querySelector("#parseReview").textContent = missing.length
    ? `识别完成，但这些字段需要人工补充：${missing.join("、")}`
    : "识别完成，关键字段齐全，请人工核对后发布。";
  document.querySelectorAll("#orderForm input, #orderForm textarea").forEach((field) => field.classList.remove("needs-review"));
  missing.forEach((name) => {
    const fieldName = ({ 年级: "grade", 科目: "subject", 时间: "lessonTime", 报价: "price", 地址: "address" })[name];
    if (fieldName && document.querySelector(`[name="${fieldName}"]`)) document.querySelector(`[name="${fieldName}"]`).classList.add("needs-review");
  });
}

function resetOrderForm() {
  document.querySelector("#rawText").value = "";
  document.querySelector("#orderForm").reset();
  document.querySelector("#parseReview").classList.add("hidden");
  document.querySelectorAll(".needs-review").forEach((field) => field.classList.remove("needs-review"));
  renderAgentOptions();
}

function requiredFields(order) {
  return core.REQUIRED_ORDER_FIELDS.filter((field) => !String(order[field.name] || "").trim()).map((field) => field.label);
}

async function submitAgent(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  if (!core.canManageAgents(currentAgent)) return showToast("只有管理员可以生成中介账号");
  const form = new FormData(formElement);
  const agent = {
    id: `agent_${Date.now()}`,
    account: "",
    name: String(form.get("name") || "").trim(),
    wechat: String(form.get("wechat") || "").trim(),
    phone: String(form.get("phone") || "").trim(),
    role: "staff",
    active: true
  };
  if (!useApi) {
    agent.account = core.nextAgentAccount(state.agents);
    agent.password = "";
  }
  if (!agent.name) return showToast("请填写中介名称");
  if (agent.wechat && state.agents.some((item) => item.wechat === agent.wechat)) return showToast("该中介微信已存在");
  if (useApi) {
    try {
      const payload = await apiJson("/api/agent/agents", { method: "POST", body: agent });
      state.agents = [payload.agent, ...state.agents.filter((item) => item.id !== payload.agent.id)];
      formElement.reset();
      renderAgentOptions();
      renderAgentList();
      return showToast(`账号 ${payload.agent.account} 已创建，临时密码：${payload.temporaryPassword}`);
    } catch (error) {
      return showToast(error.message);
    }
  } else {
    state.agents = [agent, ...state.agents];
    saveState();
  }
  formElement.reset();
  renderAgentOptions();
  renderAgentList();
  showToast(`已生成中介账号：${agent.account}`);
}

async function submitProfile(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const account = String(form.get("account") || "").trim();
  const name = String(form.get("name") || "").trim();
  const wechat = String(form.get("wechat") || "").trim();
  const phone = String(form.get("phone") || "").trim();
  const password = String(form.get("password") || "").trim();
  if (!account || !name || (currentAgent.role === "staff" && !wechat)) return showToast("请填写登录账号、中介名称和微信");
  if (state.agents.some((agent) => agent.id !== currentAgent.id && [agent.account, agent.phone, agent.wechat].includes(account))) {
    return showToast("登录账号已被占用");
  }
  if (phone && state.agents.some((agent) => agent.id !== currentAgent.id && [agent.account, agent.phone].includes(phone))) {
    return showToast("手机号已被占用");
  }
  if (useApi) {
    try {
      const payload = await apiJson("/api/agent/profile", { method: "PATCH", body: { account, name, wechat, phone, password } });
      currentAgent = payload.agent;
      state.agents = payload.agents?.length ? payload.agents : [payload.agent];
    } catch (error) {
      return showToast(error.message);
    }
  } else {
    currentAgent.account = account;
    currentAgent.name = name;
    currentAgent.wechat = wechat;
    currentAgent.phone = phone;
    if (password) currentAgent.password = password;
    saveState();
    localStorage.setItem(SESSION_KEY, currentAgent.id);
  }
  fillProfileForm();
  applyRoleView();
  renderAgentOptions();
  renderAgentList();
  renderStaff();
  document.querySelector("#currentAccount").textContent = `当前账号：${currentAgent.name}（${currentAgent.account}）`;
  showToast("账号信息已保存");
}

function fillProfileForm() {
  const form = document.querySelector("#profileForm");
  if (!form || !currentAgent) return;
  form.elements.account.value = currentAgent.account || "";
  form.elements.name.value = currentAgent.name || "";
  form.elements.wechat.value = currentAgent.wechat || "";
  form.elements.phone.value = currentAgent.phone || "";
  form.elements.password.value = "";
}

function renderAgentOptions() {
  const select = document.querySelector("#agentSelect");
  if (!select) return;
  const agents = state.agents.filter((agent) => agent.active);
  select.innerHTML = agents.map((agent) => (
    `<option value="${escapeAttr(agent.id)}"${agent.id === currentAgent?.id ? " selected" : ""}>${escapeHtml(agent.name)}（${escapeHtml(agent.wechat)}）</option>`
  )).join("");
}

function renderAgentList() {
  const list = document.querySelector("#agentList");
  if (!list) return;
  list.innerHTML = state.agents.map((agent) => `
    <div class="agent-card">
      <strong>${escapeHtml(agent.name)}</strong>
      <span>账号：${escapeHtml(agent.account)} ${agent.role === "admin" ? "管理员" : "中介"}</span>
      <span>微信：${escapeHtml(agent.wechat || "未填写")} 手机：${escapeHtml(agent.phone || "未填写")}</span>
      ${core.canManageAgents(currentAgent) && agent.role !== "admin" ? `<button class="small" data-reset-password="${escapeAttr(agent.id)}">重置密码</button>` : ""}
    </div>
  `).join("");
  list.querySelectorAll("[data-reset-password]").forEach((button) => {
    button.addEventListener("click", () => resetAgentPassword(button.dataset.resetPassword));
  });
}

async function resetAgentPassword(agentId) {
  if (!core.canManageAgents(currentAgent)) return showToast("只有管理员可以重置密码");
  const agent = state.agents.find((item) => item.id === agentId);
  if (!agent) return;
  if (!await askConfirm(`确认重置 ${agent.name} 的密码？`, "系统会生成一次性临时密码，中介首次登录后必须修改。")) return;
  if (useApi) {
    try {
      const payload = await apiJson(`/api/agent/agents/${encodeURIComponent(agentId)}/reset-password`, { method: "PATCH" });
      return showToast(`临时密码：${payload.temporaryPassword}`);
    } catch (error) {
      return showToast(error.message);
    }
  } else {
    agent.password = "";
    saveState();
  }
  showToast(`已重置 ${agent.name} 的密码`);
}

function addLog(order, action, reason, actor) {
  order.logs = order.logs || [];
  order.logs.unshift({ at: now(), actor, action, reason });
}

function logList(order) {
  const logs = order.logs || [];
  if (!logs.length) return "";
  return `
    <details class="logs">
      <summary>操作记录 ${logs.length} 条</summary>
      ${logs.map((log) => `<p>${escapeHtml(formatDate(log.at))} ${escapeHtml(log.actor || "中介")} ${escapeHtml(log.action)}${log.reason ? `：${escapeHtml(log.reason)}` : ""}</p>`).join("")}
    </details>
  `;
}

function renderChips(filters) {
  const chips = [
    ...filters.grades.map((value) => ({ label: "年级", value, type: "grade" })),
    ...filters.subjects.map((value) => ({ label: "科目", value, type: "subject" })),
    ...filters.areas.map((value) => ({ label: "区域", value, type: "area" })),
    filters.keyword && { label: "搜索", value: filters.keyword, type: "keyword" }
  ].filter(Boolean);
  document.querySelector("#activeChips").innerHTML = chips.map((chip) => (
    `<span>${escapeHtml(chip.label)}: ${escapeHtml(chip.value)} <button data-clear-type="${escapeAttr(chip.type)}" data-clear-value="${escapeAttr(chip.value)}">×</button></span>`
  )).join("");
  document.querySelectorAll("[data-clear-type]").forEach((button) => {
    button.addEventListener("click", () => clearTeacherFilter(button.dataset.clearType, button.dataset.clearValue));
  });
  updateFilterLabels();
}

function clearTeacherFilter(type, value) {
  if (type === "keyword") document.querySelector("#teacherSearch").value = "";
  else teacherSelections[type].delete(value);
  teacherPage = 1;
  renderTeacher();
}

function fillFilterMenu(selector, filterName, values) {
  document.querySelector(selector).innerHTML = values.map((value) => (
    `<button type="button" data-filter-option="${escapeAttr(filterName)}" data-value="${escapeAttr(value)}">${escapeHtml(value)}</button>`
  )).join("");
  document.querySelectorAll(`[data-filter-option="${filterName}"]`).forEach((button) => {
    button.addEventListener("click", () => {
      toggleSelection(filterName, button.dataset.value);
      renderTeacher();
    });
  });
}

function toggleSelection(filterName, value) {
  if (teacherSelections[filterName].has(value)) teacherSelections[filterName].delete(value);
  else teacherSelections[filterName].add(value);
  teacherPage = 1;
}

function toggleFilterMenu(filterName) {
  document.querySelectorAll(".filter-menu").forEach((menu) => {
    menu.classList.toggle("open", menu.dataset.filter === filterName && !menu.classList.contains("open"));
  });
}

function closeFilterMenus() {
  document.querySelectorAll(".filter-menu").forEach((menu) => menu.classList.remove("open"));
}

function updateFilterLabels() {
  const labels = { grade: "年级", subject: "科目", area: "区域" };
  Object.entries(labels).forEach(([key, label]) => {
    const selected = [...teacherSelections[key]];
    const button = document.querySelector(`[data-filter-toggle="${key}"]`);
    button.textContent = selected.length ? `${label} +${selected.length}` : label;
    document.querySelectorAll(`[data-filter-option="${key}"]`).forEach((option) => {
      option.classList.toggle("selected", teacherSelections[key].has(option.dataset.value));
    });
  });
}

function renderPagination(selector, pageData, onChange) {
  const nav = document.querySelector(selector);
  if (!nav) return;
  if (pageData.totalPages <= 1) {
    nav.innerHTML = "";
    return;
  }
  const pages = visiblePages(pageData.page, pageData.totalPages);
  nav.innerHTML = [
    `<button type="button" data-page-target="${pageData.page - 1}" ${pageData.page <= 1 ? "disabled" : ""}>‹</button>`,
    ...pages.map((item) => item === "..."
      ? `<span class="page-ellipsis">...</span>`
      : `<button type="button" data-page-target="${item}" class="${item === pageData.page ? "active" : ""}">${item}</button>`),
    `<button type="button" data-page-target="${pageData.page + 1}" ${pageData.page >= pageData.totalPages ? "disabled" : ""}>›</button>`,
    `<span class="page-summary">共 ${pageData.totalItems} 条</span>`
  ].join("");
  nav.querySelectorAll("[data-page-target]").forEach((button) => {
    button.addEventListener("click", () => onChange(Number(button.dataset.pageTarget)));
  });
}

function visiblePages(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set([1, total, current, current - 1, current + 1]);
  if (current <= 3) [2, 3, 4, 5].forEach((pageNumber) => pages.add(pageNumber));
  if (current >= total - 2) [total - 4, total - 3, total - 2, total - 1].forEach((pageNumber) => pages.add(pageNumber));
  const sorted = [...pages].filter((pageNumber) => pageNumber >= 1 && pageNumber <= total).sort((a, b) => a - b);
  const result = [];
  sorted.forEach((pageNumber, index) => {
    if (index > 0 && pageNumber - sorted[index - 1] > 1) result.push("...");
    result.push(pageNumber);
  });
  return result;
}

function loadingCards(count = 2) {
  return Array.from({ length: count }, () => `<article class="order-card loading-card" aria-hidden="true">
    <div class="skeleton skeleton-title"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton skeleton-short"></div>
  </article>`).join("");
}

function retryState(title, message, key) {
  return `<div class="load-error"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>
    <button class="primary" data-retry="${escapeAttr(key)}">重试</button></div>`;
}

function bindRetryButton(root, callback) {
  root.querySelector("[data-retry]")?.addEventListener("click", callback);
}

function openOrderEditor(order) {
  if (!order || !["active", "paused"].includes(order.status)) return showToast("该订单当前不可编辑");
  const fields = [
    ["orderNo", "订单号"], ["studentGender", "学生性别"], ["grade", "年级"], ["subject", "科目"],
    ["area", "区域"], ["score", "当前成绩"], ["lessonTime", "补习时间"], ["price", "报价"],
    ["address", "地址"], ["parentName", "家长称呼"], ["parentPhone", "家长电话"], ["parentWechat", "家长微信"]
  ];
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  backdrop.innerHTML = `<section class="dialog-panel order-editor" role="dialog" aria-modal="true" aria-labelledby="editOrderTitle">
    <h2 id="editOrderTitle">编辑订单 ${escapeHtml(order.orderNo)}</h2>
    <form class="form" data-order-editor>
      ${fields.map(([name, label]) => `<label><span>${label}</span><input name="${name}" value="${escapeAttr(order[name] || "")}"></label>`).join("")}
      <label class="wide"><span>对老师要求</span><textarea name="requirement" rows="3">${escapeHtml(order.requirement || "")}</textarea></label>
      <label class="wide"><span>内部备注</span><textarea name="internalNote" rows="3">${escapeHtml(order.internalNote || "")}</textarea></label>
      <label class="wide"><span>修改原因</span><input name="reason" required placeholder="例如：家长调整上课时间"></label>
      <div class="dialog-actions wide"><button type="button" data-editor-cancel>取消</button><button class="primary" type="submit">保存修改</button></div>
    </form>
  </section>`;
  document.body.appendChild(backdrop);
  const form = backdrop.querySelector("form");
  let dirty = false;
  form.addEventListener("input", () => { dirty = true; });
  const close = async () => {
    if (dirty && !await askConfirm("放弃未保存的修改？", "关闭后，本次填写的内容不会保存。")) return;
    backdrop.remove();
  };
  backdrop.querySelector("[data-editor-cancel]").addEventListener("click", close);
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const button = event.submitter;
    button.disabled = true;
    try {
      await apiJson(`/api/agent/orders/${encodeURIComponent(order.id)}`, { method: "PATCH", body: { ...data, version: order.version } });
      dirty = false;
      backdrop.remove();
      await renderStaff();
      showToast("订单修改已保存");
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
    }
  });
  form.elements.grade.focus();
}

function bindCopyButtons(root) {
  root.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await copyText(button.dataset.copy);
        showToast("已复制");
      } catch {
        showToast("复制失败，请长按文字手动复制");
      }
    });
  });
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const textarea = document.createElement("textarea");
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function orderAgentText(order) {
  return `订单号：${order.orderNo}\n中介微信：${order.agentWechat}\n老师您好，我想咨询这个家教订单。`;
}

async function exportData() {
  if (!await askConfirm("确认导出完整数据？", "导出文件会包含订单和家长联系方式，请妥善保存，不要发给无关人员。")) return;
  let backup = { ...state, exportedAt: now(), version: 4 };
  if (useApi) {
    try {
      backup = await apiJson("/api/agent/export");
    } catch (error) {
      return showToast(error.message);
    }
  } else {
    backup = {
      ...backup,
      agents: state.agents.map(({ password, passwordHash, ...agent }) => agent)
    };
  }
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `家教平台备份-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importData(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!await askConfirm("确认导入备份数据？", "导入会覆盖当前订单和中介账号数据，请确认已选择正确文件。")) {
    event.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported.orders) || !Array.isArray(imported.agents)) throw new Error("bad data");
      if (useApi) {
        await apiJson("/api/agent/import", { method: "POST", body: imported });
        const me = await apiJson("/api/agent/me");
        currentAgent = me.agent;
        state.agents = me.agents || state.agents;
      } else {
        state = {
          agents: imported.agents.map(normalizeAgent),
          orders: imported.orders.map(normalizeOrder),
          backups: imported.backups || []
        };
        saveState();
        currentAgent = state.agents.find((agent) => agent.id === localStorage.getItem(SESSION_KEY) && agent.active) || state.agents[0];
        if (currentAgent) localStorage.setItem(SESSION_KEY, currentAgent.id);
      }
      renderAgentOptions();
      renderAgentList();
      renderStaff();
      showToast("数据已导入");
    } catch {
      showToast("导入失败，请选择正确的备份 JSON 文件。");
    }
  };
  reader.readAsText(file);
}

async function resetDemoData() {
  if (!await askConfirm("确认清空当前数据并恢复演示数据？", "这个操作不可撤销，请确认已经导出备份。")) return;
  if (useApi) {
    try {
      await apiJson("/api/agent/reset-demo", { method: "POST" });
      await logoutAgent();
      return showToast("已恢复演示数据，请重新登录");
    } catch (error) {
      return showToast(error.message);
    }
  }
  state = cloneDemoData();
  saveState();
  currentAgent = state.agents[0];
  localStorage.setItem(SESSION_KEY, currentAgent.id);
  renderAgentOptions();
  renderAgentList();
  renderStaff();
  resetOrderForm();
  showToast("已恢复演示数据");
}

function fillDatalist(selector, values) {
  document.querySelector(selector).innerHTML = values.map((value) => `<option value="${escapeAttr(value)}"></option>`).join("");
}

function enrichedOrders() {
  return state.orders.map((order) => {
    const agent = findAgent(order.agentId);
    return {
      ...order,
      agentName: agent.name,
      agentWechat: agent.wechat
    };
  });
}

function findAgent(agentId) {
  return state.agents.find((agent) => agent.id === agentId) || state.agents[0] || { id: "", name: "中介", wechat: "" };
}

function countStatuses() {
  return state.orders.reduce((acc, order) => {
    acc[order.status] = (acc[order.status] || 0) + 1;
    return acc;
  }, { active: 0, paused: 0, completed: 0, cancelled: 0, deleted: 0 });
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved?.orders && saved?.agents) {
      return ensureDemoOrderVolume({
        agents: migrateAgents(saved.agents.map(normalizeAgent)),
        orders: saved.orders.map(normalizeOrder),
        backups: saved.backups || []
      });
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  const seeded = cloneDemoData();
  seeded.orders.forEach((order) => {
    const agent = seeded.agents.find((item) => item.id === order.agentId) || seeded.agents[0];
    order.logs = [{ at: now(), actor: agent.name, action: "发布订单", reason: "演示数据" }];
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
  return seeded;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function cloneDemoData() {
  return JSON.parse(JSON.stringify(demoData));
}

function ensureDemoOrderVolume(data) {
  const hasSeedData = data.orders.some((order) => order.id === "order_seed_1");
  const hasExtraData = data.orders.some((order) => String(order.id).startsWith("order_extra_"));
  if (!hasSeedData || hasExtraData) return data;
  data.orders = [...data.orders, ...createExtraDemoOrders(20).map(normalizeOrder)];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return data;
}

function normalizeAgent(agent) {
  return {
    id: String(agent.id || `agent_${Date.now()}`),
    account: String(agent.account || agent.wechat || ""),
    name: String(agent.name || "中介"),
    wechat: String(agent.wechat || ""),
    phone: String(agent.phone || ""),
    password: String(agent.password || ""),
    role: String(agent.role || "staff"),
    active: agent.active !== false
  };
}

function migrateAgents(agents) {
  const migrated = agents.map((agent, index) => {
    const copy = { ...agent };
    if (copy.id === "agent_1" && copy.wechat === "agent001") {
      copy.role = "staff";
      if (!/^\d{3}$/.test(copy.account)) copy.account = "001";
    }
    if (copy.id === "agent_2" && copy.wechat === "agent002") {
      copy.role = "staff";
      if (!/^\d{3}$/.test(copy.account)) copy.account = "002";
    }
    if (!copy.account && copy.role === "staff") copy.account = String(index + 1).padStart(3, "0");
    return copy;
  });
  if (!migrated.some((agent) => agent.role === "admin")) {
    migrated.unshift({ id: "admin_1", account: "demo-admin", name: "管理员", wechat: "", phone: "", password: "", role: "admin", active: true });
  }
  return migrated;
}

function normalizeOrder(order) {
  return {
    id: String(order.id || `order_${Date.now()}`),
    orderNo: String(order.orderNo || ""),
    studentGender: String(order.studentGender || "未说明"),
    grade: cleanGrade(order.grade),
    subject: String(order.subject || ""),
    score: String(order.score || ""),
    lessonTime: String(order.lessonTime || ""),
    price: String(order.price || ""),
    area: String(order.area || firstMatch(order.address, core.FILTERS.areas)),
    address: String(order.address || ""),
    requirement: String(order.requirement || ""),
    parentName: String(order.parentName || ""),
    parentPhone: String(order.parentPhone || ""),
    parentWechat: String(order.parentWechat || ""),
    internalNote: String(order.internalNote || ""),
    rawText: String(order.rawText || ""),
    assignedTeacherContact: String(order.assignedTeacherContact || ""),
    agentId: String(order.agentId || "agent_1"),
    status: ["active", "paused", "completed", "cancelled", "deleted"].includes(order.status) ? order.status : "active",
    createdAt: String(order.createdAt || now()),
    updatedAt: String(order.updatedAt || now()),
    logs: Array.isArray(order.logs) ? order.logs : []
  };
}

function firstMatch(text, list) {
  return list.find((item) => String(text || "").includes(item)) || "";
}

function cleanGrade(value) {
  return String(value || "").replace(/^新(?=初|高)/, "");
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function relativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未记录";
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 60) return minutes <= 5 ? "刚刚" : `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  if (hours < 48) return "昨天";
  return formatDate(value);
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), 2200);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
