const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");

const {
  inspectTabularHeaders,
  parseCsvBuffer,
  parseSpreadsheetBuffer,
  parseTextItems,
  validateImportItem
} = require("../src/imports.js");

test("continuous WeChat text is split by repeated order numbers without blank lines", () => {
  const items = parseTextItems(`🎉🎉🎉编号：001426
地址：咸阳市秦都区金科世界城1期
科目：数学、物理
年级：新初二
学生性别：男孩
老师性别：不限
学历要求：大学生老师
开始时间：7月中旬-8月中下旬
教学频率：早9晚6
每次时长：1h
课时费：60/h
其他要求：有初中经验
🎉🎉🎉编号：001102（老家长，暑假找）
地址：雁塔区西派樘樾
科目：奥数
年级：四年级
学生性别：女孩
老师性别：女
学历要求：大学生
教学频率：1次/周
每次时长：2h
课时费：120~140/2h
其他要求：有竞赛经验`);

  assert.equal(items.length, 2);
  assert.equal(items[0].parsedData.orderNo, "001426");
  assert.equal(items[0].parsedData.startTimeText, "7月中旬-8月中下旬");
  assert.equal(items[0].parsedData.lessonFrequency, "早9晚6");
  assert.equal(items[0].parsedData.lessonDuration, "1h");
  assert.equal(items[0].parsedData.teacherGenderRequirement, "不限");
  assert.equal(items[0].parsedData.teacherEducationRequirement, "大学生老师");
  assert.equal(items[0].fieldConfidence.grade, "high");
  assert.equal(items[1].parsedData.orderNo, "001102");
});

test("approved order format separates rough and detailed addresses", () => {
  const [item] = parseTextItems(`🎉🎉🎉编号：001546
地址：灞桥区纺织城林河春天
详细地址：林河春天8号楼2单元
科目：数学
年级：新初三
区域：灞桥区
成绩：数学80-90分
老师性别：不限
学历要求：大学生老师
开始时间：最近就可以
教学频率：15次左右
每次时长：2h
课时费：80/h
家长微信：demoParent01
其他要求：要有带过初三毕业班经验，能提分`);
  assert.equal(item.parsedData.roughAddress, "灞桥区纺织城林河春天");
  assert.equal(item.parsedData.address, "林河春天8号楼2单元");
  assert.equal(item.parsedData.parentWechat, "demoParent01");
  assert.equal(item.reviewStatus, "ready");
});

test("inferred or missing required fields are never marked ready", () => {
  const [item] = parseTextItems("初二数学，雁塔区小寨，每周一次，每次2小时，120元/小时");
  assert.equal(item.reviewStatus, "needs_review");
  assert.ok(item.warnings.some((warning) => warning.includes("识别不确定")));
});

test("tabular preview reports known mappings and unknown headers", () => {
  const preview = inspectTabularHeaders(["学生年级", "辅导科目", "自定义联系人", "课时费"]);
  assert.deepEqual(preview.mapped, {
    学生年级: "grade",
    辅导科目: "subject",
    课时费: "price"
  });
  assert.deepEqual(preview.unmapped, ["自定义联系人"]);
});

test("wechat text becomes separate staged items with validation warnings", () => {
  const items = parseTextItems("年级：初二\n科目：数学\n区域：雁塔区\n成绩：80分\n补习时间：周末\n报价：100元/小时\n地址：小寨附近\n详细地址：小寨小区8号楼\n家长微信：demoParent02\n\n家长想找老师");
  assert.equal(items.length, 2);
  assert.equal(items[0].parsedData.grade, "初二");
  assert.equal(items[0].parsedData.roughAddress, "小寨附近");
  assert.equal(items[0].parsedData.address, "小寨小区8号楼");
  assert.equal(items[0].reviewStatus, "ready");
  assert.equal(items[1].reviewStatus, "needs_review");
  assert.ok(items[1].warnings.length > 0);
});

test("CSV aliases are mapped to canonical order fields", async () => {
  const csv = Buffer.from("学生年级,补习科目,区域,当前成绩,补习时间,报价,粗略地址,详细地址,家长微信\n高一,物理,碑林区,70分,周六,150元/小时,边家村附近,边家村8号楼,demoParent03", "utf8");
  const items = await parseCsvBuffer(csv);
  assert.equal(items.length, 1);
  assert.equal(items[0].parsedData.grade, "高一");
  assert.equal(items[0].parsedData.subject, "物理");
  assert.equal(items[0].reviewStatus, "ready");
});

test("xlsx first sheet is parsed and capped before staging", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("订单");
  sheet.addRow(["年级", "科目", "区域", "成绩", "时间", "报价", "粗略地址", "详细地址", "家长微信"]);
  sheet.addRow(["初三", "英语", "高新区", "90分", "周日", "120元/小时", "科技路附近", "科技路8号楼", "demoParent04"]);
  const buffer = await workbook.xlsx.writeBuffer();
  const items = await parseSpreadsheetBuffer(Buffer.from(buffer));
  assert.equal(items.length, 1);
  assert.equal(items[0].parsedData.roughAddress, "科技路附近");
  assert.equal(items[0].parsedData.address, "科技路8号楼");
});

test("validation reports all required missing fields", () => {
  const result = validateImportItem({ grade: "初一" });
  assert.equal(result.reviewStatus, "needs_review");
  assert.ok(result.warnings.some((warning) => warning.includes("科目")));
  assert.ok(result.warnings.some((warning) => warning.includes("粗略地址")));
  assert.ok(result.warnings.some((warning) => warning.includes("详细地址")));
  assert.ok(result.warnings.some((warning) => warning.includes("家长微信")));
});

test("imported rows cannot claim the automatic XJ order number namespace", () => {
  const result = validateImportItem({
    orderNo: "XJ0000000123", grade: "初二", subject: "数学", area: "雁塔区",
    score: "80分", lessonTime: "周末", price: "100元/小时", roughAddress: "测试地址附近",
    address: "测试地址8号楼", parentWechat: "demoParent05"
  });
  assert.equal(result.reviewStatus, "needs_review");
  assert.ok(result.warnings.some((warning) => warning.includes("XJ")));
});
