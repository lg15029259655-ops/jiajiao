const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");
const { createPool } = require("../src/database.js");
const { createRepository } = require("../src/repository.js");
const {
  MAX_IMPORT_ROWS, parseCsvBuffer, parseSpreadsheetBuffer, parseTextItems
} = require("../src/imports.js");
const { loadEnvFile } = require("./neon.js");

function parseCliArgs(argv = process.argv.slice(2)) {
  const values = Object.fromEntries(argv.filter((value) => value.startsWith("--") && value.includes("="))
    .map((value) => value.slice(2).split(/=(.*)/s).slice(0, 2)));
  return {
    mode: argv.includes("--stage") ? "stage" : "dry-run",
    file: values.file || "",
    batchId: values.batch || "",
    agent: values.agent || "",
    output: values.output || "",
    mappingFile: values.mapping || ""
  };
}

async function loadImportItems(filePath, mappingFile = "") {
  const extension = path.extname(filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);
  const columnMapping = mappingFile ? JSON.parse(fs.readFileSync(mappingFile, "utf8")) : undefined;
  const options = { maxRows: MAX_IMPORT_ROWS, columnMapping };
  if (extension === ".txt") return parseTextItems(buffer.toString("utf8"), options);
  if (extension === ".csv") return parseCsvBuffer(buffer, options);
  if (extension === ".xlsx") return parseSpreadsheetBuffer(buffer, options);
  throw new Error("Only .txt, .csv and .xlsx files are supported");
}

function confidenceSummary(item) {
  return Object.entries(item.fieldConfidence || {}).map(([field, level]) => `${field}:${level}`).join("; ");
}

async function writeDryRunReport(items, outputPath) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Import review");
  sheet.columns = [
    { header: "Row", key: "row", width: 10 },
    { header: "Order number", key: "orderNo", width: 18 },
    { header: "Raw text", key: "rawText", width: 60 },
    { header: "Review status", key: "reviewStatus", width: 18 },
    { header: "Warnings", key: "warnings", width: 45 },
    { header: "Confidence", key: "confidence", width: 45 },
    { header: "Parsed data", key: "parsedData", width: 80 },
    { header: "Fingerprint", key: "fingerprint", width: 66 }
  ];
  for (const item of items) {
    sheet.addRow({
      row: item.rowNumber,
      orderNo: item.parsedData?.orderNo || "",
      rawText: item.rawText || "",
      reviewStatus: item.reviewStatus,
      warnings: (item.warnings || []).join("; "),
      confidence: confidenceSummary(item),
      parsedData: JSON.stringify(item.parsedData || {}),
      fingerprint: item.contentFingerprint || ""
    });
  }
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: "H1" };
  await workbook.xlsx.writeFile(outputPath);
  return outputPath;
}

async function stageItems(items, options, connectionString) {
  if (!options.agent) throw new Error("--agent=<account> is required for staging");
  const pool = createPool(connectionString, { pooled: false });
  const repository = createRepository(pool);
  try {
    const actor = await repository.findAgentByLogin(options.agent);
    if (!actor?.active) throw new Error("The staging agent account was not found or is inactive");
    if (options.batchId) return await repository.resumeImportBatch(options.batchId, items, actor);
    return await repository.createImportBatch({
      sourceType: path.extname(options.file).toLowerCase() === ".txt" ? "text" : "spreadsheet",
      filename: path.basename(options.file),
      items
    }, actor);
  } finally {
    await repository.close();
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  if (!options.file) throw new Error("--file=<path> is required");
  const filePath = path.resolve(options.file);
  const items = await loadImportItems(filePath, options.mappingFile ? path.resolve(options.mappingFile) : "");
  if (options.mode === "dry-run") {
    const output = path.resolve(options.output || `${filePath}.review.xlsx`);
    await writeDryRunReport(items, output);
    return { mode: "dry-run", output, totalCount: items.length };
  }
  loadEnvFile();
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required for staging");
  const { items: _stagedItems, ...summary } = await stageItems(items, { ...options, file: filePath }, connectionString);
  return { mode: "stage", ...summary };
}

if (require.main === module) {
  main().then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { loadImportItems, main, parseCliArgs, stageItems, writeDryRunReport };
