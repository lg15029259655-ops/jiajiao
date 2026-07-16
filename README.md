# 家教平台

老师端与中介端使用两个独立链接，共用 Fastify + PostgreSQL 后端。正式页面只连接 Neon，不会在数据库异常时回退到浏览器 `localStorage` 或本地 JSON。

## 页面

- 老师端：`/teacher.html`，只展示招募中订单和公开字段。
- 中介端：`/agent.html`，提供订单录入、待审核、订单管理和账号安全。
- 健康检查：`/health/live` 与 `/health/ready`。

手机老师端为单列订单卡，电脑老师端自动使用多列。每页固定返回 10 条，筛选、搜索、计数和分页均由 PostgreSQL 完成。

## 订单流程

- `招募中`：老师端可见，可以编辑、锁单、取消或标记无效。
- `锁单沟通`：老师端不可见，必须记录接单老师联系方式；可以恢复招募或结束订单。
- `试课成功`、`家长取消`、`无效订单`：进入历史，只读保存。
- 历史不是订单状态，不再使用“已归档”。删除也是软删除，不会物理移除记录。

所有编辑和状态变化使用订单 `version` 防止多人覆盖，并记录操作者、原因、旧值和新值。结束满 6 个月后，定时维护命令会清除家长及接单老师的敏感联系方式。

## 环境配置

复制 `.env.example` 为 `.env`，不要把 `.env` 提交到 Git。

```dotenv
# 当前兼容连接；本地验收可以暂时使用 direct 地址
DATABASE_URL=postgresql://...

# 正式网站运行时使用：从 Neon Connect 弹窗复制准确的 pooled 连接串
DATABASE_POOL_URL=postgresql://...-pooler.../neondb?sslmode=require

# 迁移、备份和恢复使用：Neon direct 连接串
DATABASE_DIRECT_URL=postgresql://.../neondb?sslmode=require

APP_ORIGIN=https://你的正式域名
NODE_ENV=production
PORT=8765
BACKUP_ENCRYPTION_KEY=至少12位的独立随机密钥
```

已经出现在聊天、截图或历史配置中的数据库密码，正式部署前必须在 Neon 控制台轮换。

## 本地运行

```bash
pnpm install
pnpm run db:migrate
pnpm start
```

然后打开：

- `http://127.0.0.1:8765/teacher.html`
- `http://127.0.0.1:8765/agent.html`

数据库配置缺失或不可用时，服务会明确启动失败，不会生成演示订单。

## 导入审核

- 支持微信文本、`.csv` 和 `.xlsx`。
- 单个文件不超过 10 MB，单批不超过 5,000 行。
- 所有导入内容先写入暂存表，不直接发布。
- 系统检查必填字段、订单号、家长电话/微信、地址组合和原始文本相似度。
- 疑似重复项必须人工核对；错误行可导出 CSV。

## 测试

```bash
pnpm test
pnpm run test:integration
```

普通测试不修改云端数据。集成测试会在 Neon 创建临时 schema，验证迁移、5,000 条分页和并发修改，完成后自动删除测试 schema。

## 维护与备份

```bash
pnpm run db:anonymize
pnpm run db:backup
node db/restore.js backups/文件名.tutorbackup --dry-run
```

备份使用 AES-256-GCM 加密。恢复命令默认只校验；实际恢复必须显式使用 `--apply --target-schema=<非public测试schema>`，禁止直接覆盖正式 `public` schema。

公网部署阶段还需配置：每日加密备份到独立对象存储、30 天保留、定时运行脱敏和会话清理、HTTPS、正式域名与 `APP_ORIGIN`。

## Render 部署

仓库包含 `render.yaml`。在 Render 中选择 **New + > Blueprint** 并连接本仓库，然后填写三个数据库连接变量：

- `DATABASE_URL`：Neon pooled 连接串。
- `DATABASE_POOL_URL`：同一条 Neon pooled 连接串。
- `DATABASE_DIRECT_URL`：Neon direct 连接串。

Render 会自动设置公网地址、`PORT` 和 HTTPS。后续推送到部署分支时会自动更新网站。绑定自定义域名后，将 `APP_ORIGIN` 设置为完整的 HTTPS 域名。
