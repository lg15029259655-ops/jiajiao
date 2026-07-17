const ExcelJS = require("exceljs");
const crypto = require("node:crypto");
const { parse } = require("csv-parse/sync");
const { parseOrderText, splitOrderText } = require("../platform-core.js");
const { domainError } = require("./domain.js");

const MAX_IMPORT_ROWS = 5000;
const MAX_WEB_IMPORT_ROWS = 200;
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const REQUIRED_FIELDS = [
  ["grade", "年级"], ["subject", "科目"], ["area", "区域"], ["score", "当前成绩"],
  ["lessonTime", "补习时间"], ["price", "报价"], ["roughAddress", "粗略地址"],
  ["address", "详细地址"], ["parentWechat", "家长微信"]
];

const FIELD_ALIASES = {
  orderNo: ["订单号", "订单编号", "编号", "orderNo"],
  studentGender: ["学生性别", "性别", "studentGender"],
  grade: ["学生年级", "年级", "grade"],
  subject: ["补习科目", "辅导科目", "科目", "subject"],
  area: ["区域", "所在区域", "区县", "area"],
  score: ["当前成绩", "现阶段成绩", "成绩", "score"],
  lessonTime: ["补习时间", "辅导时间", "时间", "lessonTime"],
  startTimeText: ["开始时间", "开课时间", "startTimeText"],
  lessonFrequency: ["教学频率", "补习频率", "上课频率", "lessonFrequency"],
  lessonDuration: ["每次时长", "单次时长", "lessonDuration"],
  price: ["报价", "课时费", "价格", "price"],
  roughAddress: ["粗略地址", "补习地址", "地址", "位置", "roughAddress"],
  address: ["详细地址", "具体地址", "门牌地址", "address"],
  requirement: ["对老师要求", "老师要求", "要求", "requirement"],
  teacherGenderRequirement: ["老师性别", "教师性别", "teacherGenderRequirement"],
  teacherEducationRequirement: ["学历要求", "老师学历", "teacherEducationRequirement"],
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

function validateImportItem(parsedData, fieldConfidence) {
  const warnings = [];
  if (/^XJ\d+$/i.test(String(parsedData?.orderNo || "").trim())) {
    warnings.push("XJ开头的订单号由系统自动生成，请清空该编号后重新审核");
  }
  for (const [field, label] of REQUIRED_FIELDS) {
    if (!String(parsedData?.[field] ?? "").trim()) warnings.push(`缺少${label}`);
    else if (fieldConfidence && fieldConfidence[field] !== "high") warnings.push(`识别不确定：${label}`);
  }
  return { warnings, reviewStatus: warnings.length ? "needs_review" : "ready" };
}

function stagedItem(parsedData, rawText = "", rowNumber = 1, metadata = {}) {
  const normalized = Object.fromEntries(Object.entries(parsedData || {}).map(([key, value]) => [key, normalizeValue(value)]));
  const fieldConfidence = metadata.fieldConfidence || {};
  const fieldSources = metadata.fieldSources || {};
  const validation = validateImportItem(normalized, fieldConfidence);
  const fingerprintSource = JSON.stringify([
    normalized.orderNo || "", normalized.parentPhone || "", normalized.parentWechat || "",
    normalized.address || "", normalized.grade || "", normalized.subject || "", rawText
  ]);
  const contentFingerprint = crypto.createHash("sha256").update(fingerprintSource).digest("hex");
  return { rowNumber, rawText, parsedData: normalized, fieldConfidence, fieldSources, contentFingerprint, ...validation };
}

function parseTextItems(content, options = {}) {
  const limit = Number(options.maxRows || MAX_WEB_IMPORT_ROWS);
  const chunks = splitOrderText(content);
  if (chunks.length > limit) throw domainError("IMPORT_TOO_MANY_ROWS", `单批最多导入${limit}条`, 400);
  return chunks.map((rawText, index) => {
    const parsed = parseOrderText(rawText);
    const { fieldConfidence, fieldSources, ...parsedData } = parsed;
    return stagedItem(parsedData, rawText, index + 1, { fieldConfidence, fieldSources });
  });
}

function mapTabularRows(records, options = {}) {
  const limit = Number(options.maxRows || MAX_WEB_IMPORT_ROWS);
  if (records.length > limit) throw domainError("IMPORT_TOO_MANY_ROWS", `单批最多导入${limit}条`, 400);
  return records.map((record, index) => {
    const parsedData = {};
    const fieldConfidence = {};
    const fieldSources = {};
    for (const [header, value] of Object.entries(record)) {
      const field = options.columnMapping?.[header] || ALIAS_LOOKUP[cleanHeader(header)];
      if (field) parsedData[field] = value;
      if (field) {
        fieldConfidence[field] = String(value ?? "").trim() ? "high" : "low";
        fieldSources[field] = { header };
      }
    }
    return stagedItem(parsedData, JSON.stringify(record), index + 1, { fieldConfidence, fieldSources });
  });
}

function inspectTabularHeaders(headers) {
  const mapped = {};
  const unmapped = [];
  for (const header of headers) {
    const field = ALIAS_LOOKUP[cleanHeader(header)];
    if (field) mapped[header] = field;
    else unmapped.push(header);
  }
  return { mapped, unmapped };
}

async function parseCsvBuffer(buffer, options = {}) {
  assertFileSize(buffer);
  const records = parse(buffer, { bom: true, columns: true, skip_empty_lines: true, relax_column_count: true, trim: true });
  return mapTabularRows(records, options);
}

async function parseSpreadsheetBuffer(buffer, options = {}) {
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
    if (rows.length >= Number(options.maxRows || MAX_WEB_IMPORT_ROWS) + 1) return;
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    if (Object.values(record).some((value) => String(value).trim())) rows.push(record);
  });
  return mapTabularRows(rows, options);
}

function normalizeValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return value;
  return String(value).trim();
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
  FIELD_ALIASES, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, MAX_WEB_IMPORT_ROWS, inspectTabularHeaders,
  mapTabularRows, parseCsvBuffer, parseSpreadsheetBuffer, parseTextItems, stagedItem, validateImportItem
};
