const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");

const { parseCsvBuffer, parseSpreadsheetBuffer, parseTextItems, validateImportItem } = require("../src/imports.js");

test("wechat text becomes separate staged items with validation warnings", () => {
  const items = parseTextItems("年级：初二\n科目：数学\n区域：雁塔区\n成绩：80分\n补习时间：周末\n报价：100元/小时\n地址：小寨\n\n家长想找老师");
  assert.equal(items.length, 2);
  assert.equal(items[0].parsedData.grade, "初二");
  assert.equal(items[0].reviewStatus, "ready");
  assert.equal(items[1].reviewStatus, "needs_review");
  assert.ok(items[1].warnings.length > 0);
});

test("CSV aliases are mapped to canonical order fields", async () => {
  const csv = Buffer.from("学生年级,补习科目,区域,当前成绩,补习时间,报价,详细地址\n高一,物理,碑林区,70分,周六,150元/小时,边家村", "utf8");
  const items = await parseCsvBuffer(csv);
  assert.equal(items.length, 1);
  assert.equal(items[0].parsedData.grade, "高一");
  assert.equal(items[0].parsedData.subject, "物理");
  assert.equal(items[0].reviewStatus, "ready");
});

test("xlsx first sheet is parsed and capped before staging", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("订单");
  sheet.addRow(["年级", "科目", "区域", "成绩", "时间", "报价", "地址"]);
  sheet.addRow(["初三", "英语", "高新区", "90分", "周日", "120元/小时", "科技路"]);
  const buffer = await workbook.xlsx.writeBuffer();
  const items = await parseSpreadsheetBuffer(Buffer.from(buffer));
  assert.equal(items.length, 1);
  assert.equal(items[0].parsedData.address, "科技路");
});

test("validation reports all required missing fields", () => {
  const result = validateImportItem({ grade: "初一" });
  assert.equal(result.reviewStatus, "needs_review");
  assert.ok(result.warnings.some((warning) => warning.includes("科目")));
  assert.ok(result.warnings.some((warning) => warning.includes("地址")));
});
