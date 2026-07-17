const fs = require("node:fs");
const path = require("node:path");

const grades = ["小学三年级", "小学五年级", "初一", "初二", "初三", "高一", "高二", "高三"];
const subjects = ["数学", "英语", "语文", "物理", "化学", "生物", "历史", "地理"];
const areas = ["雁塔区", "碑林区", "莲湖区", "未央区", "新城区", "灞桥区", "长安区", "高新区"];
const streets = ["科技路", "长安路", "太白路", "凤城五路", "咸宁路", "纺织城正街", "韦曲南街", "丈八北路"];
const scores = ["基础一般，最近考试70分左右", "基础较弱，需要从课本补起", "成绩中等，希望稳定提升", "成绩较好，希望拔高", "偏科明显，需要梳理知识点"];
const times = ["周六下午", "周日上午", "工作日晚上", "周末时间可协商", "暑假上午"];
const requirements = ["有耐心，能帮助整理错题", "熟悉教材和学校进度", "讲解清楚，能够长期稳定上课", "有相关辅导经验优先", "认真负责，课后及时反馈"];

function createOrder(index) {
  const position = index - 1;
  const area = areas[position % areas.length];
  const lines = [
    `编号：${String(990000 + index).padStart(6, "0")}`,
    `地址：西安市${area}${streets[position % streets.length]}测试点${index}附近`,
    `详细地址：西安市${area}${streets[position % streets.length]}测试小区${index}号楼2单元`,
    `区域：${area}`,
    `科目：${subjects[(position * 3) % subjects.length]}`,
    `年级：${grades[position % grades.length]}`,
    `学生性别：${index % 2 ? "女" : "男"}`,
    `老师性别：${index % 4 === 0 ? "女老师优先" : "不限"}`,
    `学历要求：${index % 5 === 0 ? "研究生优先" : "本科及以上"}`,
    `开始时间：${index % 3 === 0 ? "下周开始" : "可尽快开始"}`,
    `教学频率：每周${index % 3 === 0 ? 3 : 2}次`,
    `每次时长：${index % 4 === 0 ? "1.5小时" : "2小时"}`,
    `补习时间：${times[position % times.length]}`,
    `家长微信：syntheticParent${String(index).padStart(2, "0")}`
  ];
  if (index % 23 !== 0) lines.push(`课时费：${80 + (position % 8) * 10}元/小时`);
  if (index % 17 !== 0) lines.push(`当前成绩：${scores[position % scores.length]}`);
  lines.push(`其他要求：${requirements[position % requirements.length]}。本订单为系统生成的脱敏测试数据。`);
  return lines.join("\n");
}

function main(output = process.argv[2]) {
  const outputPath = path.resolve(output || path.join(__dirname, "..", "artifacts", "synthetic-orders-50.txt"));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const content = Array.from({ length: 50 }, (_, index) => createOrder(index + 1)).join("\n\n");
  fs.writeFileSync(outputPath, `${content}\n`, "utf8");
  console.log(JSON.stringify({ output: outputPath, count: 50 }));
}

if (require.main === module) main();

module.exports = { createOrder };
