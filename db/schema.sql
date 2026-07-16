-- 家教平台正式 PostgreSQL 数据库结构
-- 设计目标：云端优先、支持 5000+ 至数万订单、支持表格/文本导入、待审核、历史留存和审计日志。

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  wechat TEXT,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_profile_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id),
  old_display_name TEXT,
  new_display_name TEXT,
  old_wechat TEXT,
  new_wechat TEXT,
  changed_by UUID REFERENCES agents(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no TEXT NOT NULL UNIQUE,
  student_gender TEXT,
  grade TEXT NOT NULL,
  subject TEXT NOT NULL,
  score TEXT,
  lesson_time TEXT NOT NULL,
  price TEXT NOT NULL,
  area TEXT NOT NULL,
  address TEXT NOT NULL,
  teacher_requirement TEXT,
  parent_name TEXT,
  parent_phone TEXT,
  parent_wechat TEXT,
  internal_note TEXT,
  raw_text TEXT,
  assigned_teacher_contact TEXT,
  agent_id UUID REFERENCES agents(id),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'cancelled', 'deleted')),
  close_reason TEXT,
  review_status TEXT NOT NULL DEFAULT 'needs_review'
    CHECK (review_status IN ('ready', 'needs_review', 'rejected', 'published')),
  import_batch_id UUID,
  import_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  inquiry_count INTEGER NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  actor_agent_id UUID REFERENCES agents(id),
  actor_name_snapshot TEXT,
  action TEXT NOT NULL,
  reason TEXT,
  from_status TEXT,
  to_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL CHECK (source_type IN ('text', 'spreadsheet', 'system_export')),
  original_filename TEXT,
  raw_payload JSONB,
  created_by UUID REFERENCES agents(id),
  total_count INTEGER NOT NULL DEFAULT 0,
  ready_count INTEGER NOT NULL DEFAULT 0,
  needs_review_count INTEGER NOT NULL DEFAULT 0,
  published_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE orders
    ADD CONSTRAINT fk_orders_import_batch
    FOREIGN KEY (import_batch_id) REFERENCES import_batches(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_review_status ON orders(review_status);
CREATE INDEX IF NOT EXISTS idx_orders_agent_id ON orders(agent_id);
CREATE INDEX IF NOT EXISTS idx_orders_grade_subject_area ON orders(grade, subject, area);
CREATE INDEX IF NOT EXISTS idx_orders_parent_phone ON orders(parent_phone);
CREATE INDEX IF NOT EXISTS idx_orders_parent_wechat ON orders(parent_wechat);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_logs_order_id ON order_logs(order_id);
