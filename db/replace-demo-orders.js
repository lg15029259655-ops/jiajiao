const { createPool, transaction } = require("../src/database.js");
const { createRepository } = require("../src/repository.js");

const OLD_BATCH_ID = "58f88b6d-818e-410d-835b-9dfb1c4860eb";
const NEW_BATCH_FILENAME = "synthetic-demo-orders-50-v2-20260717";
const REQUIRED_FIELDS = [
  "grade", "subject", "area", "score", "lessonTime", "price",
  "roughAddress", "address", "parentWechat"
];

const locations = [
  { area: "雁塔区", rough: "雁塔区小寨赛格附近", detail: "小寨华旗国际" },
  { area: "雁塔区", rough: "雁塔区曲江池东路附近", detail: "曲江公馆和园" },
  { area: "碑林区", rough: "碑林区交大兴庆校区附近", detail: "交大二村" },
  { area: "碑林区", rough: "碑林区边家村附近", detail: "东泰城市之光" },
  { area: "灞桥区", rough: "灞桥区纺织城林河春天", detail: "林河春天" },
  { area: "莲湖区", rough: "莲湖区劳动公园附近", detail: "丰庆苑" },
  { area: "未央区", rough: "未央区凤城五路附近", detail: "海荣豪佳花园" },
  { area: "高新区", rough: "高新区科技六路附近", detail: "天地源枫林意树" },
  { area: "长安区", rough: "长安区大学城附近", detail: "万科城" },
  { area: "长安区", rough: "交大创新港附近", detail: "创新港人才公寓" }
];

const grades = ["新初一", "新初二", "新初三", "新高一", "新高二", "新高三", "四年级", "五年级", "六年级", "初二"];
const subjects = ["数学", "英语", "物理", "化学", "语文", "数学、物理", "物理、化学", "英语、语文", "数学、英语", "全科作业辅导"];
const scores = ["基础薄弱，60分左右", "目前70分左右", "目前80-90分", "成绩中等，希望稳定提高", "基础不错，需要培优", "刚及格，需要补基础", "校内成绩85分左右", "计算容易出错", "知识点掌握不系统", "需要衔接新学期课程"];
const times = ["周一、周三晚间", "周二、周四晚间", "周五晚间和周日下午", "周六上午", "周六下午", "周日上午", "暑假白天可协商", "每周末一次", "工作日晚间两次", "具体时间与老师协商"];
const requirements = [
  "老师耐心负责，讲题思路清晰，能帮助整理错题。",
  "有同年级辅导经验，熟悉校内教材和考试重点。",
  "希望老师能制定阶段学习计划，每次课后反馈情况。",
  "要教得好，时间和课时费可以协商。",
  "有毕业班带课经验，重点解决不会的题目并帮助提分。",
  "善于启发学生，不只是直接给答案。",
  "课堂互动好，能帮助孩子养成检查和复盘习惯。",
  "要求时间稳定，至少可以连续辅导一个学期。",
  "基础知识讲解细致，可以适当安排课后练习。",
  "沟通耐心，能够根据学生接受情况调整进度。"
];

function assertOldBatchCount(count) {
  if (Number(count) !== 100) {
    throw new Error(`Old demo batch safety check failed: expected exactly 100 orders, found ${count}`);
  }
}

function buildDemoItems() {
  return Array.from({ length: 50 }, (_, index) => {
    const number = index + 1;
    const location = locations[index % locations.length];
    const parsedData = {
      studentGender: number % 2 ? "男孩" : "女孩",
      grade: grades[(index * 3) % grades.length],
      subject: subjects[(index * 7) % subjects.length],
      area: location.area,
      score: scores[(index * 9) % scores.length],
      lessonTime: times[(index * 4) % times.length],
      startTimeText: number % 3 === 0 ? "最近就可以" : "暑假开始",
      lessonFrequency: number % 3 === 0 ? "每周3次" : "每周2次",
      lessonDuration: number % 4 === 0 ? "每次2.5小时" : "每次2小时",
      price: number % 10 === 0 ? "老师报价" : `${80 + (index % 7) * 10}元/小时`,
      roughAddress: location.rough,
      address: `${location.detail}${(number % 12) + 1}号楼${(number % 4) + 1}单元${100 + number}室`,
      requirement: requirements[(index * 6) % requirements.length],
      teacherGenderRequirement: number % 5 === 0 ? "女老师优先" : "不限",
      teacherEducationRequirement: number % 6 === 0 ? "交大在读研究生" : "大学生老师，本科及以上",
      parentName: number % 2 ? "学生妈妈" : "学生爸爸",
      parentPhone: "",
      parentWechat: `demoParent${String(number).padStart(4, "0")}`,
      internalNote: `【虚拟演示数据】第${String(number).padStart(3, "0")}条，不对应真实学生。`,
      rawText: ""
    };
    return {
      rowNumber: number,
      rawText: "",
      parsedData,
      fieldConfidence: Object.fromEntries(REQUIRED_FIELDS.map((field) => [field, "high"])),
      fieldSources: Object.fromEntries(REQUIRED_FIELDS.map((field) => [field, { source: "synthetic-demo-v2" }])),
      warnings: []
    };
  });
}

async function main() {
  const pool = createPool(process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL, { pooled: false });
  const repository = createRepository(pool);
  try {
    const migration = await pool.query("SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 9) AS applied");
    if (!migration.rows[0]?.applied) throw new Error("Migration 009 is not applied; replacement stopped safely.");

    const actor = await repository.findAgentByLogin("001");
    if (!actor?.active || actor.role !== "staff" || !String(actor.wechat || "").trim()) {
      throw new Error("Active staff account 001 with intermediary WeChat is required.");
    }

    const oldBatch = await pool.query("SELECT id FROM import_batches WHERE id = $1", [OLD_BATCH_ID]);
    if (oldBatch.rows[0]) {
      const oldCount = await pool.query("SELECT count(*)::int AS count FROM orders WHERE import_batch_id = $1", [OLD_BATCH_ID]);
      assertOldBatchCount(oldCount.rows[0].count);
    }

    let newBatch = await pool.query("SELECT id FROM import_batches WHERE original_filename = $1 ORDER BY created_at DESC LIMIT 1", [NEW_BATCH_FILENAME]);
    let batchId = newBatch.rows[0]?.id;
    if (!batchId) {
      const batch = await repository.createImportBatch({
        sourceType: "text",
        filename: NEW_BATCH_FILENAME,
        items: buildDemoItems()
      }, actor);
      if (batch.readyCount !== 50 || batch.needsReviewCount !== 0) {
        throw new Error(`New demo staging failed: ready=${batch.readyCount}, needsReview=${batch.needsReviewCount}`);
      }
      batchId = batch.id;
    }

    let publishedThisRun = 0;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const ready = await pool.query("SELECT count(*)::int AS count FROM import_items WHERE batch_id = $1 AND review_status = 'ready'", [batchId]);
      if (ready.rows[0].count === 0) break;
      const published = await repository.publishImportBatch(batchId, {}, actor);
      publishedThisRun += Number(published.publishedCount || 0);
    }

    const newState = await pool.query(`SELECT b.status, b.needs_review_count,
      count(i.*) FILTER (WHERE i.review_status = 'published')::int AS published_items,
      count(o.*) FILTER (WHERE o.status = 'active' AND o.review_status = 'published')::int AS active_published
      FROM import_batches b
      LEFT JOIN import_items i ON i.batch_id = b.id
      LEFT JOIN orders o ON o.id = i.published_order_id
      WHERE b.id = $1 GROUP BY b.id`, [batchId]);
    const state = newState.rows[0];
    if (Number(state?.published_items) !== 50 || Number(state?.active_published) !== 50 || state?.status !== "completed") {
      throw new Error(`New demo verification failed: status=${state?.status}, published=${state?.published_items}`);
    }

    let deletedOldOrders = 0;
    if (oldBatch.rows[0]) {
      deletedOldOrders = await transaction(pool, async (client) => {
        await client.query("DELETE FROM import_items WHERE batch_id = $1", [OLD_BATCH_ID]);
        const deleted = await client.query("DELETE FROM orders WHERE import_batch_id = $1", [OLD_BATCH_ID]);
        assertOldBatchCount(deleted.rowCount);
        await client.query("DELETE FROM import_batches WHERE id = $1", [OLD_BATCH_ID]);
        return deleted.rowCount;
      });
    }

    const total = await pool.query("SELECT count(*)::int AS count FROM orders WHERE status <> 'deleted'");
    console.log(JSON.stringify({
      batchId,
      deletedOldOrders,
      publishedNewOrders: Number(state.published_items),
      publishedThisRun,
      needsReview: Number(state.needs_review_count),
      totalOrders: total.rows[0].count,
      batchStatus: state.status
    }));
  } finally {
    await repository.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { OLD_BATCH_ID, NEW_BATCH_FILENAME, assertOldBatchCount, buildDemoItems, main };
