const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ExcelJS = require("exceljs");

const { loadImportItems, parseCliArgs, writeDryRunReport } = require("../db/import-initial.js");
const { createOrder } = require("../db/generate-synthetic-import.js");

test("initial import CLI parses dry-run and resume options", () => {
  assert.deepEqual(parseCliArgs([
    "--dry-run", "--file=orders.txt", "--batch=batch-id", "--agent=001", "--output=check.xlsx"
  ]), {
    mode: "dry-run", file: "orders.txt", batchId: "batch-id", agent: "001", output: "check.xlsx", mappingFile: ""
  });
});

test("text dry-run accepts up to 5000 rows and writes a review workbook", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-import-"));
  const input = path.join(directory, "orders.txt");
  const output = path.join(directory, "review.xlsx");
  fs.writeFileSync(input, [
    "编号：001426\n地址：雁塔区小寨\n科目：数学\n年级：初二\n成绩：80分\n补习时间：周末\n课时费：120元/小时",
    "编号：001427\n地址：碑林区边家村\n科目：英语\n年级：初一"
  ].join("\n\n"), "utf8");

  const items = await loadImportItems(input);
  assert.equal(items.length, 2);
  assert.equal(items[0].parsedData.orderNo, "001426");
  await writeDryRunReport(items, output);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(output);
  assert.equal(workbook.worksheets[0].rowCount, 3);
  assert.equal(workbook.worksheets[0].getRow(2).getCell(1).value, 1);
  assert.equal(workbook.worksheets[0].getRow(3).getCell(4).value, "needs_review");
});

test("synthetic sample produces 50 separable orders with review edge cases", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-synthetic-"));
  const input = path.join(directory, "synthetic.txt");
  fs.writeFileSync(input, Array.from({ length: 50 }, (_, index) => createOrder(index + 1)).join("\n\n"), "utf8");

  const items = await loadImportItems(input);
  assert.equal(items.length, 50);
  assert.equal(items[0].parsedData.orderNo, "990001");
  assert.ok(items.some((item) => item.reviewStatus === "ready"));
  assert.ok(items.some((item) => item.reviewStatus === "needs_review"));
  assert.ok(items.every((item) => item.rawText.includes("脱敏测试数据")));
});
