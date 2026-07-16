const ExcelJS = require("exceljs");
const { parse } = require("csv-parse/sync");
const { parseOrderText } = require("../platform-core.js");
const { domainError } = require("./domain.js");

const MAX_IMPORT_ROWS = 5000;
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const REQUIRED_FIELDS = [
  ["grade", "年级"], ["subject", "科目"], ["area", "区域"], ["score", "当前成绩"],
  ["lessonTime", "补习时间"], ["price", "报价"], ["address", "地址"]
];

const FIELD_ALIASES = {
  orderNo: ["订单号", "订单编号", "编号", "orderNo"],
  studentGender: ["学生性别", "性别", "studentGender"],
  grade: ["学生年级", "年级", "grade"],
  subject: ["补习科目", "辅导科目", "科目", "subject"],
  area: ["区域", "所在区域", "区县", "area"],
  score: ["当前成绩", "现阶段成绩", "成绩", "score"],
  lessonTime: ["补习时间", "辅导时间", "时间", "lessonTime"],
  price: ["报价", "课时费", "价格", "price"],
  address: ["详细地址", "补习地址", "地址", "address"],
  requirement: ["对老师要求", "老师要求", "要求", "requirement"],
  parentName: ["家长姓名", "parentName"],
  parentPhone: ["家长电话", "联系电话", "手机号", "parentPhone"],
  parentWechat: ["家长微信", "微信", "parentWechat"],
  internalNote: ["内部备注", "备注", "internalNote"],
  rawText: ["原始文本", "rawText"]
};

function cleanHeader(value) {
  return String(value ?? "").trim().replace(/[：:\s_\-]/g, "").toLowerCase();
}

const ALIAS_LOOKUP = Object.fromEntries(Object.entries(FIELD_ALIASES).flatMap(([field, aliases]) => aliases.map((alias) => [cleanHeader(alias), field])));

function validateImportItem(parsedData) {
  const warnings = REQUIRED_FIELDS
    .filter(([field]) => !String(parsedData?.[field] ?? "").trim())
    .map(([, label]) => `缺少${label}`);
  return { warnings, reviewStatus: warnings.length ? "needs_review" : "ready" };
}

function stagedItem(parsedData, rawText = "", rowNumber = 1) {
  const normalized = Object.fromEntries(Object.entries(parsedData || {}).map(([key, value]) => [key, String(value ?? "").trim()]));
  const validation = validateImportItem(normalized);
  return { rowNumber, rawText, parsedData: normalized, ...validation };
}

function parseTextItems(content) {
  const chunks = String(content || "").trim().split(/\r?\n\s*\r?\n+/).map((item) => item.trim()).filter(Boolean);
  if (chunks.length > MAX_IMPORT_ROWS) throw domainError("IMPORT_TOO_MANY_ROWS", `单批最多导入${MAX_IMPORT_ROWS}条`, 400);
  return chunks.map((rawText, index) => stagedItem(parseOrderText(rawText), rawText, index + 1));
}

function mapTabularRows(records) {
  if (records.length > MAX_IMPORT_ROWS) throw domainError("IMPORT_TOO_MANY_ROWS", `单批最多导入${MAX_IMPORT_ROWS}条`, 400);
  return records.map((record, index) => {
    const parsedData = {};
    for (const [header, value] of Object.entries(record)) {
      const field = ALIAS_LOOKUP[cleanHeader(header)];
      if (field) parsedData[field] = value;
    }
    return stagedItem(parsedData, JSON.stringify(record), index + 1);
  });
}

async function parseCsvBuffer(buffer) {
  assertFileSize(buffer);
  const records = parse(buffer, { bom: true, columns: true, skip_empty_lines: true, relax_column_count: true, trim: true });
  return mapTabularRows(records);
}

async function parseSpreadsheetBuffer(buffer) {
  assertFileSize(buffer);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const rows = [];
  const headers = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const values = row.values.slice(1).map(cellText);
    if (rowNumber === 1) {
      headers.push(...values);
      return;
    }
    if (rows.length >= MAX_IMPORT_ROWS + 1) return;
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    if (Object.values(record).some((value) => String(value).trim())) rows.push(record);
  });
  return mapTabularRows(rows);
}

function cellText(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return value.text || value.result || value.hyperlink || String(value);
  return String(value);
}

function assertFileSize(buffer) {
  if (!Buffer.isBuffer(buffer)) throw domainError("IMPORT_FILE_INVALID", "上传文件无效", 400);
  if (buffer.length > MAX_IMPORT_BYTES) throw domainError("IMPORT_FILE_TOO_LARGE", "文件不能超过10 MB", 413);
}

module.exports = {
  FIELD_ALIASES, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, mapTabularRows, parseCsvBuffer,
  parseSpreadsheetBuffer, parseTextItems, validateImportItem
};
