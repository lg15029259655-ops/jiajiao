const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  FILTERS,
  PAGE_SIZE,
  REQUIRED_ORDER_FIELDS,
  STAFF_ACTIONS,
  canEnterOrders,
  canManageAgents,
  findDuplicateWarnings,
  getStaffOrders,
  getTeacherOrders,
  matchesTeacherFilters,
  nextOrderNo,
  nextAgentAccount,
  paginate,
  parseOrderText,
  publicOrder,
  queryStaffOrders,
  queryTeacherOrders
} = require("./platform-core.js");

const orders = [
  {
    id: "o1",
    orderNo: "062701",
    status: "active",
    studentGender: "女孩",
    grade: "初二",
    subject: "数学、英语",
    area: "雁塔区",
    address: "雁塔区科技一路花园印象",
    parentPhone: "13900000000",
    parentWechat: "parent001",
    agentName: "中介A",
    agentWechat: "agent001",
    rawText: "初二数学英语，雁塔区科技一路花园印象"
  },
  {
    id: "o2",
    orderNo: "062702",
    status: "paused",
    grade: "高一",
    subject: "物理",
    area: "碑林区",
    address: "碑林区边家村",
    parentPhone: "",
    parentWechat: "",
    rawText: "高一物理，碑林区边家村"
  },
  {
    id: "o3",
    orderNo: "062703",
    status: "completed",
    grade: "高二",
    subject: "化学",
    area: "线上",
    address: "线上",
    parentPhone: "13800000000",
    parentWechat: "done001",
    rawText: "高二化学线上"
  }
];

const indexHtml = fs.readFileSync("./index.html", "utf8");
const appJs = fs.readFileSync("./app.js", "utf8");
assert.equal(indexHtml.includes("agent.html"), false);
assert.equal(indexHtml.includes('data-page="teacher"'), true);
assert.equal(/createExtraDemoOrders\(20\)/.test(appJs), true);

assert.equal(PAGE_SIZE.teacher, 10);
assert.equal(PAGE_SIZE.staff, 10);

assert.deepEqual(getTeacherOrders(orders).map((order) => order.orderNo), ["062701"]);
assert.deepEqual(getStaffOrders(orders).map((order) => order.orderNo), ["062701", "062702"]);

assert.equal(matchesTeacherFilters(orders[0], { grade: "初中", subject: "数学", area: "雁塔区", keyword: "" }), true);
assert.equal(matchesTeacherFilters(orders[0], { grade: "高中", subject: "", area: "", keyword: "" }), false);
assert.equal(
  matchesTeacherFilters(orders[0], {
    grades: ["高一", "初二"],
    subjects: ["物理", "数学"],
    areas: ["碑林区", "雁塔区"],
    keyword: ""
  }),
  true
);
assert.equal(
  matchesTeacherFilters(orders[0], {
    grades: ["高一", "高二"],
    subjects: ["物理", "化学"],
    areas: ["碑林区"],
    keyword: ""
  }),
  false
);

assert.deepEqual(FILTERS.subjects, ["语文", "数学", "英语", "物理", "化学", "生物", "历史", "地理", "政治", "全科", "其他"]);
assert.equal(FILTERS.subjects.includes("语数英"), false);
assert.equal(FILTERS.grades.some((grade) => grade.includes("新初") || grade.includes("新高")), false);
assert.deepEqual(REQUIRED_ORDER_FIELDS.map((field) => field.label), ["年级", "科目", "区域", "现阶段成绩", "时间", "报价", "地址"]);
assert.equal(REQUIRED_ORDER_FIELDS.some((field) => field.name === "requirement"), false);
assert.deepEqual(STAFF_ACTIONS.active.map((action) => action.status), ["paused", "deleted"]);
assert.deepEqual(STAFF_ACTIONS.paused.map((action) => action.status), ["active", "completed", "deleted"]);
assert.equal([...STAFF_ACTIONS.active, ...STAFF_ACTIONS.paused].some((action) => action.status === "cancelled"), false);
assert.equal(canEnterOrders({ role: "staff" }), true);
assert.equal(canEnterOrders({ role: "admin" }), false);
assert.equal(canManageAgents({ role: "admin" }), true);
assert.equal(canManageAgents({ role: "staff" }), false);
assert.equal(nextAgentAccount([{ account: "001" }, { account: "002" }]), "003");
assert.equal(nextAgentAccount([{ account: "099" }, { account: "abc" }]), "100");

assert.deepEqual(
  queryTeacherOrders(orders, { grades: ["初一", "初二"], subjects: ["数学"], areas: ["雁塔区"], page: 1 }).items.map((order) => order.orderNo),
  ["062701"]
);
assert.equal(queryTeacherOrders(orders, { page: 1 }).pageSize, 10);
assert.equal(queryTeacherOrders(orders, { page: 1 }).items[0].parentPhone, undefined);
assert.equal(queryTeacherOrders(orders, { page: 1 }).items[0].rawText, undefined);

assert.deepEqual(queryStaffOrders(orders, { keyword: "062702", page: 1 }).items.map((order) => order.orderNo), ["062702"]);
assert.deepEqual(queryStaffOrders(orders, { keyword: "062703", page: 1 }).items, []);

assert.deepEqual(
  publicOrder(orders[0]),
  {
    id: "o1",
    orderNo: "062701",
    status: "active",
    studentGender: "女孩",
    grade: "初二",
    subject: "数学、英语",
    score: "",
    lessonTime: "",
    price: "",
    area: "雁塔区",
    address: "雁塔区科技一路花园印象",
    requirement: "",
    agentName: "中介A",
    agentWechat: "agent001",
    createdAt: "",
    updatedAt: ""
  }
);

assert.deepEqual(
  findDuplicateWarnings(
    {
      orderNo: "062701",
      grade: "初二",
      subject: "数学",
      address: "雁塔区科技一路花园印象",
      parentPhone: "",
      parentWechat: "",
      rawText: "初二数学，雁塔区科技一路花园印象"
    },
    orders
  ),
  ["订单号相同", "地址 + 年级 + 科目相近", "原始文本高度相似"]
);

assert.deepEqual(
  findDuplicateWarnings(
    {
      orderNo: "",
      grade: "一年级",
      subject: "语文",
      address: "线上",
      parentPhone: "13900000000",
      parentWechat: "",
      rawText: "一年级语文线上"
    },
    orders
  ),
  ["家长微信/电话相同"]
);

assert.equal(nextOrderNo([{ orderNo: "062601" }, { orderNo: "062602" }], new Date("2026-06-26T08:00:00")), "062603");

assert.deepEqual(paginate(Array.from({ length: 25 }, (_, index) => index + 1), 2, 10), {
  items: Array.from({ length: 10 }, (_, index) => index + 11),
  page: 2,
  pageSize: 10,
  totalItems: 25,
  totalPages: 3
});
assert.equal(paginate([1, 2, 3], 99, 10).page, 1);

assert.deepEqual(
  parseOrderText("订单编号：070601\n【学生性别】：女孩\n【学生年级】：高一\n【补习科目】：数学、物理\n【报价】：120元/小时\n【地址】：雁塔区科技一路\n【补习时间】：每周2次\n【对老师要求】：女老师，有经验\n家长电话：13911112222\n家长微信：parent0706"),
  {
    orderNo: "070601",
    studentGender: "女孩",
    grade: "高一",
    subject: "数学、物理",
    area: "雁塔区",
    score: "",
    lessonTime: "每周2次",
    price: "120元/小时",
    address: "雁塔区科技一路",
    requirement: "女老师，有经验",
    parentPhone: "13911112222",
    parentWechat: "parent0706",
    rawText: "订单编号：070601\n【学生性别】：女孩\n【学生年级】：高一\n【补习科目】：数学、物理\n【报价】：120元/小时\n【地址】：雁塔区科技一路\n【补习时间】：每周2次\n【对老师要求】：女老师，有经验\n家长电话：13911112222\n家长微信：parent0706"
  }
);
assert.equal(parseOrderText("家长想找老师，具体信息稍后补充").grade, "");
assert.equal(parseOrderText("某小学一年级学生，辅导语文数学").grade, "一年级");
assert.equal(parseOrderText("某小学一年级学生，辅导语文数学").subject, "语文、数学");
assert.equal(parseOrderText("新高一学生，辅导数学").grade, "高一");

const manyOrders = Array.from({ length: 6000 }, (_, index) => ({
  orderNo: String(700000 + index),
  status: index % 3 === 0 ? "paused" : "active",
  grade: index % 2 === 0 ? "初一" : "高二",
  subject: index % 2 === 0 ? "数学" : "物理",
  area: index % 2 === 0 ? "雁塔区" : "碑林区",
  address: `测试地址${index}`,
  parentPhone: `139${String(index).padStart(8, "0")}`,
  rawText: `测试订单${index}`
}));
const perfStart = performance.now();
const manyResult = queryTeacherOrders(manyOrders, { grades: ["初一"], subjects: ["数学"], page: 5 });
const perfMs = performance.now() - perfStart;
assert.equal(manyResult.items.length, 10);
assert.ok(manyResult.totalItems > 1000);
assert.ok(perfMs < 100, `6000条查询应保持流畅，实际 ${perfMs.toFixed(2)}ms`);

console.log("app.test.js passed");
