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
      "一年级", "二年级", "三年级", "四年级", "五年级", "六年级",
      "初一", "初二", "初三",
      "高一", "高二", "高三",
      "其他"
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
    paused: "锁单沟通",
    completed: "试课成功",
    cancelled: "家长取消",
    deleted: "无效/删除",
    pending_review: "待审核"
  };

  const WORKING_STATUSES = ["active", "paused"];
  const TERMINAL_STATUSES = ["completed", "cancelled", "deleted"];

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
    { name: "roughAddress", label: "粗略地址" },
    { name: "address", label: "详细地址" },
    { name: "parentWechat", label: "家长微信" }
  ];

  const STAFF_ACTIONS = {
    active: [
      { status: "paused", label: "暂时下架", tone: "warning" },
      { status: "cancelled", label: "家长取消", tone: "warning subtle" },
      { status: "deleted", label: "删除订单", tone: "danger subtle" }
    ],
    paused: [
      { status: "active", label: "取消下架", tone: "success" },
      { status: "completed", label: "试课成功", tone: "success" },
      { status: "cancelled", label: "家长取消", tone: "warning subtle" },
      { status: "deleted", label: "删除订单", tone: "danger subtle" }
    ],
    completed: [],
    cancelled: [],
    deleted: []
  };

  function getTeacherOrders(orders) {
    return orders.filter((order) => order.status === "active");
  }

  function getStaffOrders(orders) {
    return orders.filter((order) => WORKING_STATUSES.includes(order.status));
  }

  function getArchivedOrders(orders) {
    return orders.filter((order) => TERMINAL_STATUSES.includes(order.status));
  }

  function getReviewOrders(orders) {
    return orders.filter((order) => order.status === "pending_review");
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

  function queryArchivedOrders(orders, options = {}) {
    const keyword = String(options.keyword || "").trim();
    const status = String(options.status || "").trim();
    const filtered = getArchivedOrders(orders).filter((order) => {
      const statusOk = !status || order.status === status;
      const keywordOk = !keyword || keywordMatch(searchText(order, true), keyword);
      return statusOk && keywordOk;
    });
    return paginate(filtered, options.page, options.pageSize || PAGE_SIZE.staff);
  }

  function queryReviewOrders(orders, options = {}) {
    const keyword = String(options.keyword || "").trim();
    const reviewStatus = String(options.reviewStatus || "").trim();
    const filtered = getReviewOrders(orders).filter((order) => {
      const statusOk = !reviewStatus || order.reviewStatus === reviewStatus;
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
      startTimeText: valueOrEmpty(order.startTimeText),
      lessonFrequency: valueOrEmpty(order.lessonFrequency),
      lessonDuration: valueOrEmpty(order.lessonDuration),
      price: valueOrEmpty(order.price),
      area: valueOrEmpty(order.area),
      address: valueOrEmpty(order.address),
      requirement: valueOrEmpty(order.requirement),
      teacherGenderRequirement: valueOrEmpty(order.teacherGenderRequirement),
      teacherEducationRequirement: valueOrEmpty(order.teacherEducationRequirement),
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
        , order.reviewStatus, order.importWarnings
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
    const source = cleanOrderText(text);
    const compact = source.replace(/\s+/g, " ");
    const fields = {};
    const fieldConfidence = {};
    const fieldSources = {};
    const explicit = (field, names) => {
      const hit = labelDetail(source, names);
      if (hit.value) setParsedField(fields, fieldConfidence, fieldSources, field, hit.value, "high", hit);
      return hit.value;
    };
    const inferred = (field, value, detail = {}) => {
      if (!fields[field] && value) setParsedField(fields, fieldConfidence, fieldSources, field, value, "medium", detail);
      return fields[field] || "";
    };

    const orderNoRaw = explicit("orderNo", ["订单编号", "订单号", "编号"])
      || inferred("orderNo", ((source.match(/(?:订单(?:编号|号)?|编号)\s*[：:]?\s*(\d{5,12})/) || [])[1] || ""), { method: "pattern" });
    const orderNo = ((String(orderNoRaw).match(/\d{5,12}/) || [])[0] || orderNoRaw);
    fields.orderNo = orderNo;
    const grade = explicit("grade", ["学生年级", "年级"])
      || inferred("grade", firstMatch(compact, FILTERS.grades), { method: "dictionary" });
    const subject = explicit("subject", ["补习科目", "辅导科目", "科目", "学科"])
      || inferred("subject", subjectMatches(compact).join("、"), { method: "dictionary" });
    let area = explicit("area", ["区域", "地区", "区县"]);
    const roughAddress = explicit("roughAddress", ["粗略地址", "补习地址", "地址", "位置"])
      || inferred("roughAddress", guessAddress(compact, area), { method: "pattern" });
    const address = explicit("address", ["详细地址", "具体地址", "门牌地址"]);
    area = area || inferred("area", firstMatch(`${roughAddress} ${address} ${compact}`, FILTERS.areas), { method: "dictionary" });
    const price = explicit("price", ["报价", "课酬", "课时费", "价格", "费用"])
      || inferred("price", ((compact.match(/(\d+(?:\s*[~～至-]\s*\d+)?\s*(?:元|块)?\s*(?:\/|每|一)?\s*(?:次|课时|小时|时|h|H|月)[^，。；;]*)/) || [])[1] || ""), { method: "pattern" });
    const startTimeText = explicit("startTimeText", ["开始时间", "开课时间"]);
    const lessonFrequency = explicit("lessonFrequency", ["教学频率", "补习频率", "辅导频率", "上课频率", "每周次数"]);
    const lessonDuration = explicit("lessonDuration", ["每次时长", "单次时长"]);
    let lessonTime = explicit("lessonTime", ["补习时间", "辅导时间", "上课时间", "时间"]);
    if (!lessonTime) {
      const structuredTime = [startTimeText, lessonFrequency, lessonDuration].filter(Boolean).join("；");
      lessonTime = structuredTime
        ? setParsedField(fields, fieldConfidence, fieldSources, "lessonTime", structuredTime, "high", { method: "structured-labels" })
        : inferred("lessonTime", guessTime(compact), { method: "pattern" });
    }
    const teacherGenderRequirement = explicit("teacherGenderRequirement", ["老师性别", "教师性别"]);
    const teacherEducationRequirement = explicit("teacherEducationRequirement", ["学历要求", "老师学历", "教师学历"]);
    let requirement = explicit("requirement", ["其他要求", "对老师要求", "老师要求", "教师要求", "要求"]);
    if (!requirement) {
      const structuredRequirement = [
        teacherGenderRequirement && `老师性别：${teacherGenderRequirement}`,
        teacherEducationRequirement && `学历要求：${teacherEducationRequirement}`
      ].filter(Boolean).join("；");
      requirement = structuredRequirement
        ? setParsedField(fields, fieldConfidence, fieldSources, "requirement", structuredRequirement, "high", { method: "structured-labels" })
        : inferred("requirement", guessRequirement(compact), { method: "pattern" });
    }
    const score = explicit("score", ["现阶段成绩", "当前成绩", "成绩"]);
    const parentPhone = explicit("parentPhone", ["家长电话", "联系电话", "电话", "手机号"])
      || inferred("parentPhone", ((compact.match(/1\d{10}/) || [])[0] || ""), { method: "pattern" });
    const parentWechat = explicit("parentWechat", ["家长微信", "微信"]);
    const explicitGender = explicit("studentGender", ["学生性别", "性别"]);
    const genderText = explicitGender || compact;
    const studentGender = genderText.includes("女") ? "女孩" : genderText.includes("男") ? "男孩" : "未说明";
    if (explicitGender) setParsedField(fields, fieldConfidence, fieldSources, "studentGender", studentGender, "high", fieldSources.studentGender);
    else setParsedField(fields, fieldConfidence, fieldSources, "studentGender", studentGender, studentGender === "未说明" ? "low" : "medium", { method: "pattern" });

    const result = {
      ...fields, orderNo, studentGender, grade, subject, area, score, lessonTime, price, roughAddress, address, requirement,
      startTimeText, lessonFrequency, lessonDuration, teacherGenderRequirement, teacherEducationRequirement,
      parentPhone, parentWechat, rawText: source
    };
    for (const key of Object.keys(result)) {
      if (key === "rawText") continue;
      if (!fieldConfidence[key]) fieldConfidence[key] = result[key] ? "medium" : "low";
    }
    return { ...result, fieldConfidence, fieldSources };
  }

  function cleanOrderText(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/\r/g, "")
      .replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, "")
      .split("\n")
      .map((line) => line.replace(/^[\s🎉🎊✨🔥📌✅]+/u, "").trimEnd())
      .join("\n")
      .trim();
  }

  function splitOrderText(value) {
    const source = cleanOrderText(value);
    if (!source) return [];
    const lines = source.split("\n");
    const chunks = [];
    let current = [];
    let seenOrderNumber = false;
    for (const line of lines) {
      const boundary = /(?:订单编号|订单号|编号)\s*[:：]?\s*\d{5,12}/.test(line);
      if (boundary && seenOrderNumber && current.some((item) => item.trim())) {
        chunks.push(current.join("\n").trim());
        current = [];
      }
      if (boundary) seenOrderNumber = true;
      current.push(line);
    }
    if (current.some((item) => item.trim())) chunks.push(current.join("\n").trim());
    if (chunks.length > 1) return chunks;
    return source.split(/\n\s*\n+/).map((item) => item.trim()).filter(Boolean);
  }

  function setParsedField(fields, confidence, sources, field, value, level, detail = {}) {
    const normalized = String(value || "").trim();
    fields[field] = normalized;
    confidence[field] = normalized ? level : "low";
    if (normalized) sources[field] = detail;
    return normalized;
  }

  function labelDetail(source, names) {
    const lines = String(source || "").split(/\n+/);
    let offset = 0;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      for (const name of names) {
        const pattern = new RegExp(`^\\s*(?:【|\\[)?\\s*${escapeRegExp(name)}\\s*(?:】|\\])?\\s*[：:]\\s*(.+)$`, "i");
        const match = line.match(pattern);
        if (match) return { value: match[1].trim(), label: name, line: index + 1, start: offset, end: offset + lines[index].length };
      }
      offset += lines[index].length + 1;
    }
    for (const name of names) {
      const pattern = new RegExp(`${escapeRegExp(name)}\\s*[：:]\\s*([^\\n，。；;]+)`, "i");
      const match = source.match(pattern);
      if (match) return { value: match[1].trim(), label: name, line: null, start: match.index, end: match.index + match[0].length };
    }
    return { value: "" };
  }

  function labelValue(source, names) {
    return labelDetail(source, names).value;
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
    TERMINAL_STATUSES,
    WORKING_STATUSES,
    findDuplicateWarnings,
    canEnterOrders,
    canManageAgents,
    getArchivedOrders,
    getReviewOrders,
    getStaffOrders,
    getTeacherOrders,
    keywordMatch,
    matchesTeacherFilters,
    nextAgentAccount,
    nextOrderNo,
    paginate,
    parseOrderText,
    splitOrderText,
    publicOrder,
    queryArchivedOrders,
    queryReviewOrders,
    queryStaffOrders,
    queryTeacherOrders,
    searchText
  };
});
