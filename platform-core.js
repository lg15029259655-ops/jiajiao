(function (root, factory) {
  const core = factory();
  if (typeof module === "object" && module.exports) module.exports = core;
  root.TutorCore = core;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  const PAGE_SIZE = {
    teacher: 10,
    staff: 10
  };

  const FILTERS = {
    grades: [
      "小学", "一年级", "二年级", "三年级", "四年级", "五年级", "六年级", "小升初",
      "初中", "预初", "初一", "初二", "初三",
      "高中", "高一", "高二", "高三",
      "成人", "其他"
    ],
    subjects: ["语文", "数学", "英语", "物理", "化学", "生物", "历史", "地理", "政治", "全科", "其他"],
    areas: [
      "雁塔区", "碑林区", "莲湖区", "新城区", "未央区", "灞桥区", "长安区", "高新区",
      "经开区", "曲江新区", "浐灞区", "阎良区", "临潼区", "高陵区", "鄠邑区",
      "线上", "其他"
    ]
  };

  const STATUS_TEXT = {
    active: "招募中",
    paused: "暂时下架",
    completed: "试课成功",
    cancelled: "家长取消",
    deleted: "已删除"
  };

  const REASON_OPTIONS = {
    paused: ["大学生已交信息费", "已有老师联系", "正在沟通", "等待试课", "其他"],
    active: ["试课失败", "老师没接成", "家长继续找", "其他"],
    completed: ["家长满意开始上课", "试课成功", "其他"],
    cancelled: ["家长已找到老师", "计划取消", "价格不合适", "时间变动", "其他"],
    deleted: ["重复订单", "录入错误", "无效信息", "其他"]
  };

  const REQUIRED_ORDER_FIELDS = [
    { name: "grade", label: "年级" },
    { name: "subject", label: "科目" },
    { name: "area", label: "区域" },
    { name: "score", label: "现阶段成绩" },
    { name: "lessonTime", label: "时间" },
    { name: "price", label: "报价" },
    { name: "address", label: "地址" }
  ];

  const STAFF_ACTIONS = {
    active: [
      { status: "paused", label: "暂时下架", tone: "warning" },
      { status: "deleted", label: "删除订单", tone: "danger subtle" }
    ],
    paused: [
      { status: "active", label: "取消下架", tone: "success" },
      { status: "completed", label: "试课成功", tone: "success" },
      { status: "deleted", label: "删除订单", tone: "danger subtle" }
    ]
  };

  function getTeacherOrders(orders) {
    return orders.filter((order) => order.status === "active");
  }

  function getStaffOrders(orders) {
    return orders.filter((order) => order.status === "active" || order.status === "paused");
  }

  function queryTeacherOrders(orders, options = {}) {
    const filtered = getTeacherOrders(orders).filter((order) => matchesTeacherFilters(order, options));
    const page = paginate(filtered, options.page, options.pageSize || PAGE_SIZE.teacher);
    return { ...page, items: page.items.map(publicOrder) };
  }

  function queryStaffOrders(orders, options = {}) {
    const keyword = String(options.keyword || "").trim();
    const status = String(options.status || "").trim();
    const filtered = getStaffOrders(orders).filter((order) => {
      const statusOk = !status || order.status === status;
      const keywordOk = !keyword || keywordMatch(searchText(order, true), keyword);
      return statusOk && keywordOk;
    });
    return paginate(filtered, options.page, options.pageSize || PAGE_SIZE.staff);
  }

  function publicOrder(order) {
    return {
      id: valueOrEmpty(order.id),
      orderNo: valueOrEmpty(order.orderNo),
      status: valueOrEmpty(order.status),
      studentGender: valueOrEmpty(order.studentGender),
      grade: valueOrEmpty(order.grade),
      subject: valueOrEmpty(order.subject),
      score: valueOrEmpty(order.score),
      lessonTime: valueOrEmpty(order.lessonTime),
      price: valueOrEmpty(order.price),
      area: valueOrEmpty(order.area),
      address: valueOrEmpty(order.address),
      requirement: valueOrEmpty(order.requirement),
      agentName: valueOrEmpty(order.agentName),
      agentWechat: valueOrEmpty(order.agentWechat),
      createdAt: valueOrEmpty(order.createdAt),
      updatedAt: valueOrEmpty(order.updatedAt)
    };
  }

  function matchesTeacherFilters(order, filters = {}) {
    const grades = toArray(filters.grade || filters.grades);
    const subjects = toArray(filters.subject || filters.subjects);
    const areas = toArray(filters.area || filters.areas);
    const gradeOk = !grades.length || grades.some((grade) => matchesGrade(order.grade, grade));
    const subjectOk = !subjects.length || subjects.some((subject) => includesLoose(order.subject, subject));
    const areaOk = !areas.length || areas.some((area) => includesLoose(order.area || order.address, area));
    const keywordOk = !filters.keyword || keywordMatch(searchText(order, false), filters.keyword);
    return gradeOk && subjectOk && areaOk && keywordOk;
  }

  function searchText(order, includePrivate) {
    const parts = [
      order.orderNo, order.studentGender, order.grade, order.subject, order.score, order.lessonTime,
      order.price, order.area, order.address, order.requirement, order.agentName, order.agentWechat
    ];
    if (includePrivate) {
      parts.push(
        order.parentName, order.parentPhone, order.parentWechat, order.internalNote,
        order.rawText, STATUS_TEXT[order.status], order.assignedTeacherContact
      );
    }
    return parts.filter(Boolean).join(" ");
  }

  function findDuplicateWarnings(order, orders) {
    const warnings = new Set();
    const normalizedRaw = normalizeText(order.rawText);
    for (const existing of orders.filter((item) => item.status !== "deleted")) {
      if (order.orderNo && existing.orderNo === order.orderNo) warnings.add("订单号相同");
      if ((order.parentPhone && existing.parentPhone === order.parentPhone) || (order.parentWechat && existing.parentWechat === order.parentWechat)) {
        warnings.add("家长微信/电话相同");
      }
      if (similarCoreFields(order, existing)) warnings.add("地址 + 年级 + 科目相近");
      if (normalizedRaw && textSimilarity(normalizedRaw, normalizeText(existing.rawText)) >= 0.62) warnings.add("原始文本高度相似");
    }
    return [...warnings];
  }

  function nextOrderNo(orders, now = new Date()) {
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const prefix = `${mm}${dd}`;
    const max = orders
      .map((order) => String(order.orderNo || ""))
      .filter((orderNo) => orderNo.startsWith(prefix))
      .map((orderNo) => Number(orderNo.slice(4)))
      .filter(Number.isFinite)
      .reduce((acc, value) => Math.max(acc, value), 0);
    return `${prefix}${String(max + 1).padStart(2, "0")}`;
  }

  function nextAgentAccount(agents) {
    const max = agents
      .map((agent) => String(agent.account || ""))
      .filter((account) => /^\d{3}$/.test(account))
      .map(Number)
      .reduce((acc, value) => Math.max(acc, value), 0);
    return String(max + 1).padStart(3, "0");
  }

  function canEnterOrders(agent) {
    return String(agent?.role || "staff") === "staff";
  }

  function canManageAgents(agent) {
    return String(agent?.role || "") === "admin";
  }

  function paginate(items, requestedPage = 1, pageSize = 10) {
    const safeSize = Math.max(1, Number(pageSize) || 10);
    const totalItems = items.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / safeSize));
    const page = Math.min(totalPages, Math.max(1, Number(requestedPage) || 1));
    const start = (page - 1) * safeSize;
    return {
      items: items.slice(start, start + safeSize),
      page,
      pageSize: safeSize,
      totalItems,
      totalPages
    };
  }

  function parseOrderText(text) {
    const source = String(text || "").replace(/\r/g, "").trim();
    const compact = source.replace(/\s+/g, " ");
    const label = (...names) => labelValue(source, names);
    const orderNo = label("订单编号", "订单号", "编号") || ((source.match(/(?:订单(?:编号|号)?|编号)\s*[：:]?\s*(\d{5,12})/) || [])[1] || "");
    const grade = label("学生年级", "年级") || firstMatch(compact, FILTERS.grades);
    const subject = label("补习科目", "科目", "学科") || subjectMatches(compact).join("、");
    const area = label("区域", "地区") || firstMatch(compact, FILTERS.areas);
    const address = label("地址", "位置") || guessAddress(compact, area);
    const price = label("报价", "课酬", "价格", "费用") || ((compact.match(/(\d+\s*(?:元|块)?\s*(?:\/|每|一)?\s*(?:小时|时|h|H)[^，。；;]*)/) || [])[1] || "");
    const lessonTime = label("补习时间", "上课时间", "课时", "时间") || guessTime(compact);
    const requirement = label("对老师要求", "老师要求", "要求") || guessRequirement(compact);
    const score = label("现阶段成绩", "成绩");
    const parentPhone = label("家长电话", "电话", "手机号") || ((compact.match(/1\d{10}/) || [])[0] || "");
    const parentWechat = label("家长微信", "微信");
    const genderText = label("学生性别", "性别") || compact;
    const studentGender = genderText.includes("女") ? "女孩" : genderText.includes("男") ? "男孩" : "未说明";
    return { orderNo, studentGender, grade, subject, area, score, lessonTime, price, address, requirement, parentPhone, parentWechat, rawText: source };
  }

  function labelValue(source, names) {
    const lines = String(source || "").split(/\n+/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      for (const name of names) {
        const pattern = new RegExp(`^\\s*(?:【|\\[)?\\s*${escapeRegExp(name)}\\s*(?:】|\\])?\\s*[：:]\\s*(.+)$`, "i");
        const match = line.match(pattern);
        if (match) return match[1].trim();
      }
    }
    for (const name of names) {
      const pattern = new RegExp(`${escapeRegExp(name)}\\s*[：:]\\s*([^\\n，。；;]+)`, "i");
      const match = source.match(pattern);
      if (match) return match[1].trim();
    }
    return "";
  }

  function firstMatch(text, list) {
    return list
      .filter((item) => item !== "其他" && String(text || "").includes(item))
      .sort((left, right) => right.length - left.length)[0] || "";
  }

  function subjectMatches(text) {
    return FILTERS.subjects.filter((item) => !["其他", "全科"].includes(item) && String(text || "").includes(item));
  }

  function guessAddress(text, area) {
    const match = text.match(/(?:地址|位置|在|位于)[：:]?\s*([^，。；;]{4,48})/);
    if (match) return match[1].trim();
    if (!area) return "";
    const index = text.indexOf(area);
    return index < 0 ? "" : text.slice(index, index + 42).replace(/[，。；;].*$/, "").trim();
  }

  function guessTime(text) {
    const match = text.match(/((?:暑假|寒假|周内|周末|每周|每次|长期|继续|晚上|白天|上午|下午)[^。；;]{0,58})/);
    return match ? match[1].trim() : "";
  }

  function guessRequirement(text) {
    const match = text.match(/(?:要求|需要|希望)([^。；;]{4,90})/);
    return match ? match[1].trim() : "";
  }

  function matchesGrade(value, picked) {
    if (!picked) return true;
    if (includesLoose(value, picked)) return true;
    if (picked === "小学") return /小学|一年级|二年级|三年级|四年级|五年级|六年级|小升初/.test(value);
    if (picked === "初中") return /初|预初/.test(value);
    if (picked === "高中") return /高/.test(value);
    return false;
  }

  function includesLoose(value, picked) {
    const left = String(value || "");
    const right = String(picked || "");
    return left.includes(right) || Boolean(left && right.includes(left));
  }

  function similarCoreFields(a, b) {
    const addressOk = sharedPart(a.address, b.address) || sharedPart(a.area, b.area);
    const gradeOk = matchesGrade(a.grade, b.grade) || matchesGrade(b.grade, a.grade);
    const subjectOk = subjectTokens(a.subject).some((token) => subjectTokens(b.subject).includes(token));
    return Boolean(addressOk && gradeOk && subjectOk);
  }

  function sharedPart(a, b) {
    const left = normalizeText(a);
    const right = normalizeText(b);
    if (!left || !right) return false;
    return left.includes(right.slice(0, 6)) || right.includes(left.slice(0, 6)) || textSimilarity(left, right) >= 0.5;
  }

  function subjectTokens(subject) {
    const text = String(subject || "");
    return FILTERS.subjects.filter((item) => item !== "其他" && text.includes(item));
  }

  function textSimilarity(a, b) {
    if (!a || !b) return 0;
    const gramsA = ngrams(a);
    const gramsB = ngrams(b);
    const hit = gramsA.filter((item) => gramsB.includes(item)).length;
    return hit / Math.max(gramsA.length, gramsB.length, 1);
  }

  function ngrams(text) {
    const clean = normalizeText(text);
    if (clean.length <= 2) return clean ? [clean] : [];
    return Array.from({ length: clean.length - 1 }, (_, index) => clean.slice(index, index + 2));
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, "").replace(/[，。；;、：:【】\[\]]/g, "").toLowerCase();
  }

  function keywordMatch(text, keyword) {
    const source = String(text || "").toLowerCase();
    return String(keyword || "").toLowerCase().split(/\s+/).filter(Boolean).every((token) => source.includes(token));
  }

  function toArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value.filter(Boolean) : [value];
  }

  function valueOrEmpty(value) {
    return value == null ? "" : String(value);
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  return {
    FILTERS,
    PAGE_SIZE,
    REASON_OPTIONS,
    REQUIRED_ORDER_FIELDS,
    STAFF_ACTIONS,
    STATUS_TEXT,
    findDuplicateWarnings,
    canEnterOrders,
    canManageAgents,
    getStaffOrders,
    getTeacherOrders,
    keywordMatch,
    matchesTeacherFilters,
    nextAgentAccount,
    nextOrderNo,
    paginate,
    parseOrderText,
    publicOrder,
    queryStaffOrders,
    queryTeacherOrders,
    searchText
  };
});
