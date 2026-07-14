const STORAGE_KEY = "simple_tutor_platform_v4";
const SESSION_KEY = "simple_tutor_agent_session";
const core = window.TutorCore;
const page = document.body.dataset.page;

const now = () => new Date().toISOString();

const demoData = {
  agents: [
    { id: "admin_1", account: "admin", name: "管理员", wechat: "", phone: "", password: "admin123", role: "admin", active: true },
    { id: "agent_1", account: "001", name: "中介A", wechat: "agent001", phone: "", password: "123456", role: "staff", active: true },
    { id: "agent_2", account: "002", name: "中介B", wechat: "agent002", phone: "", password: "123456", role: "staff", active: true }
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

let state = loadState();
let teacherPage = 1;
let staffPage = 1;
let agentInitialized = false;
let currentAgent = null;

const teacherSelections = {
  grade: new Set(),
  subject: new Set(),
  area: new Set()
};

if (page === "teacher") initTeacherPage();
if (page === "agent") initAgentPage();

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
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    state = loadState();
    renderTeacher();
  });
  renderTeacher();
}

function initAgentPage() {
  document.querySelector("#loginForm").addEventListener("submit", loginAgent);
  const sessionId = localStorage.getItem(SESSION_KEY);
  currentAgent = state.agents.find((agent) => agent.id === sessionId && agent.active);
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
  document.querySelector("#exportBtn").addEventListener("click", exportData);
  document.querySelector("#resetBtn").addEventListener("click", resetDemoData);
  document.querySelector("#importInput").addEventListener("change", importData);
  document.querySelector("#logoutBtn").addEventListener("click", logoutAgent);
  document.querySelector("#orderForm").addEventListener("submit", submitOrder);
  document.querySelector("#orderForm").addEventListener("input", (event) => {
    if (event.target.value?.trim()) event.target.classList.remove("needs-review");
  });
  document.querySelector("#profileForm").addEventListener("submit", submitProfile);
  document.querySelector("#agentForm").addEventListener("submit", submitAgent);
  ["#staffSearch", "#staffStatus"].forEach((selector) => {
    document.querySelector(selector).addEventListener("input", resetStaffPage);
    document.querySelector(selector).addEventListener("change", resetStaffPage);
  });
}

function loginAgent(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const account = String(form.get("account") || "").trim();
  const password = String(form.get("password") || "").trim();
  const agent = state.agents.find((item) => {
    const loginNames = [item.account, item.phone, item.wechat].filter(Boolean);
    return loginNames.includes(account) && item.password === password && item.active;
  });
  if (!agent) return showToast("账号或密码不正确");
  currentAgent = agent;
  localStorage.setItem(SESSION_KEY, agent.id);
  event.currentTarget.reset();
  updateAuthView();
  showToast("已登录中介后台");
}

function logoutAgent() {
  localStorage.removeItem(SESSION_KEY);
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
  const canEnter = core.canEnterOrders(currentAgent);
  document.querySelector('[data-agent-tab="entry"]').classList.toggle("hidden", !canEnter);
  document.querySelector('[data-agent-page="entry"]').classList.toggle("hidden", !canEnter);
  document.querySelector("#adminAccountPanel").classList.toggle("hidden", !core.canManageAgents(currentAgent));
  if (!canEnter && document.querySelector('[data-agent-tab="entry"]').classList.contains("active")) {
    activateAgentTab("manage");
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
}

function renderTeacher() {
  const filters = {
    grades: [...teacherSelections.grade],
    subjects: [...teacherSelections.subject],
    areas: [...teacherSelections.area],
    keyword: document.querySelector("#teacherSearch").value.trim(),
    page: teacherPage
  };
  const result = core.queryTeacherOrders(enrichedOrders(), filters);
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

function renderStaff() {
  if (!currentAgent) return;
  const result = core.queryStaffOrders(enrichedOrders(), {
    keyword: document.querySelector("#staffSearch").value.trim(),
    status: document.querySelector("#staffStatus").value,
    page: staffPage
  });
  staffPage = result.page;
  const counts = countStatuses();
  document.querySelector("#staffStats").textContent = `处理中 ${counts.active + counts.paused} 单，招募中 ${counts.active}，下架中 ${counts.paused}`;
  document.querySelector("#staffList").innerHTML = result.items.map((order) => staffCard(order)).join("");
  document.querySelector("#staffEmpty").classList.toggle("hidden", result.totalItems > 0);
  renderPagination("#staffPagination", result, (pageNumber) => {
    staffPage = pageNumber;
    renderStaff();
  });
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => updateOrderStatus(button.dataset.id, button.dataset.action));
  });
  bindCopyButtons(document.querySelector("#staffList"));
}

function resetStaffPage() {
  staffPage = 1;
  renderStaff();
}

function teacherCard(order) {
  return `
    <article class="order-card public-card">
      <div class="card-head">
        <h2>订单编号：${escapeHtml(order.orderNo)}</h2>
        <button class="text-copy" data-copy="${escapeAttr(orderAgentText(order))}">复制订单号和中介微信</button>
      </div>
      <button class="address-copy" data-copy="${escapeAttr(order.address)}">⌖ 复制地址</button>
      ${infoRows(publicRows(order))}
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

function staffActions(order) {
  const actions = core.STAFF_ACTIONS[order.status] || [];
  return `<div class="actions">${actions.map((action) => (
    `<button class="${escapeAttr(action.tone)}" data-action="${escapeAttr(action.status)}" data-id="${escapeAttr(order.id)}">${escapeHtml(action.label)}</button>`
  )).join("")}</div>`;
}

function submitOrder(event) {
  event.preventDefault();
  if (!core.canEnterOrders(currentAgent)) return showToast("管理员不能录入订单");
  const form = new FormData(event.currentTarget);
  const rawText = document.querySelector("#rawText").value.trim();
  const agentId = String(form.get("agentId") || currentAgent.id || "").trim();
  const orderNo = String(form.get("orderNo") || "").trim() || core.nextOrderNo(state.orders);
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
  if (state.orders.some((item) => item.orderNo === order.orderNo && item.status !== "deleted")) {
    return alert("订单号已存在，请修改后再发布。");
  }
  const warnings = core.findDuplicateWarnings(order, state.orders);
  if (warnings.length && !confirm(`可能存在相似订单：\n${warnings.join("\n")}\n\n请确认是否继续发布？`)) return;
  addLog(order, "发布订单", "订单进入老师大厅", currentAgent.name);
  state.orders = [order, ...state.orders];
  saveState();
  resetOrderForm();
  staffPage = 1;
  renderStaff();
  activateAgentTab("manage");
  showToast("订单已发布到老师大厅");
}

function updateOrderStatus(id, nextStatus) {
  const order = state.orders.find((item) => item.id === id);
  if (!order) return;
  let teacherContact = order.assignedTeacherContact || "";
  if (nextStatus === "paused") {
    teacherContact = prompt("请输入交信息费/接单老师的微信或手机号：", teacherContact);
    if (!teacherContact?.trim()) return showToast("暂时下架必须填写老师联系方式");
  }
  const reason = askReason(nextStatus);
  if (!reason) return;
  if (["completed", "cancelled", "deleted"].includes(nextStatus)) {
    if (!confirm(`确认将订单 ${order.orderNo} 改为“${core.STATUS_TEXT[nextStatus]}”？该订单会从普通工作台消失。`)) return;
  }
  if (nextStatus === "paused") order.assignedTeacherContact = teacherContact.trim();
  order.status = nextStatus;
  order.updatedAt = now();
  addLog(order, core.STATUS_TEXT[nextStatus], reason, currentAgent.name);
  saveState();
  renderStaff();
  showToast(`订单已更新为：${core.STATUS_TEXT[nextStatus]}`);
}

function askReason(nextStatus) {
  const options = core.REASON_OPTIONS[nextStatus] || ["其他"];
  const picked = prompt(`请选择或填写原因：\n${options.join("、")}`, options[0]);
  return picked ? picked.trim() : "";
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

function submitAgent(event) {
  event.preventDefault();
  if (!core.canManageAgents(currentAgent)) return showToast("只有管理员可以生成中介账号");
  const form = new FormData(event.currentTarget);
  const account = core.nextAgentAccount(state.agents);
  const agent = {
    id: `agent_${Date.now()}`,
    account,
    name: String(form.get("name") || "").trim(),
    wechat: String(form.get("wechat") || "").trim(),
    phone: String(form.get("phone") || "").trim(),
    password: "123456",
    role: "staff",
    active: true
  };
  if (!agent.name) return showToast("请填写中介名称");
  if (agent.wechat && state.agents.some((item) => item.wechat === agent.wechat)) return showToast("该中介微信已存在");
  state.agents = [agent, ...state.agents];
  event.currentTarget.reset();
  saveState();
  renderAgentOptions();
  renderAgentList();
  showToast(`已生成中介账号：${account}，默认密码：123456`);
}

function submitProfile(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const account = String(form.get("account") || "").trim();
  const name = String(form.get("name") || "").trim();
  const wechat = String(form.get("wechat") || "").trim();
  const phone = String(form.get("phone") || "").trim();
  const password = String(form.get("password") || "").trim();
  if (!account || !name || !wechat) return showToast("请填写登录账号、中介名称和微信");
  if (state.agents.some((agent) => agent.id !== currentAgent.id && [agent.account, agent.phone, agent.wechat].includes(account))) {
    return showToast("登录账号已被占用");
  }
  if (phone && state.agents.some((agent) => agent.id !== currentAgent.id && [agent.account, agent.phone].includes(phone))) {
    return showToast("手机号已被占用");
  }
  currentAgent.account = account;
  currentAgent.name = name;
  currentAgent.wechat = wechat;
  currentAgent.phone = phone;
  if (password) currentAgent.password = password;
  saveState();
  localStorage.setItem(SESSION_KEY, currentAgent.id);
  fillProfileForm();
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

function resetAgentPassword(agentId) {
  if (!core.canManageAgents(currentAgent)) return showToast("只有管理员可以重置密码");
  const agent = state.agents.find((item) => item.id === agentId);
  if (!agent) return;
  if (!confirm(`确认将 ${agent.name} 的密码重置为 123456？`)) return;
  agent.password = "123456";
  saveState();
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

function bindCopyButtons(root) {
  root.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      await copyText(button.dataset.copy);
      showToast("已复制");
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

function exportData() {
  const backup = { ...state, exportedAt: now(), version: 4 };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `家教平台备份-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importData(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported.orders) || !Array.isArray(imported.agents)) throw new Error("bad data");
      state = {
        agents: imported.agents.map(normalizeAgent),
        orders: imported.orders.map(normalizeOrder),
        backups: imported.backups || []
      };
      saveState();
      currentAgent = state.agents.find((agent) => agent.id === localStorage.getItem(SESSION_KEY) && agent.active) || state.agents[0];
      if (currentAgent) localStorage.setItem(SESSION_KEY, currentAgent.id);
      renderAgentOptions();
      renderAgentList();
      renderStaff();
      showToast("数据已导入");
    } catch {
      alert("导入失败，请选择正确的备份 JSON 文件。");
    }
  };
  reader.readAsText(file);
}

function resetDemoData() {
  if (!confirm("确认清空当前数据并恢复演示数据？这个操作不可撤销。")) return;
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
    if (order.status === "active") acc.active += 1;
    if (order.status === "paused") acc.paused += 1;
    return acc;
  }, { active: 0, paused: 0 });
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
    password: String(agent.password || "123456"),
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
    migrated.unshift({ id: "admin_1", account: "admin", name: "管理员", wechat: "", phone: "", password: "admin123", role: "admin", active: true });
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
