-- ═══════════════════════════════════════════════════
-- AURA AI画板 · Supabase 数据库初始化脚本
-- 在 Supabase Dashboard → SQL Editor 中执行
-- ═══════════════════════════════════════════════════

-- 1. 用户资料表
CREATE TABLE IF NOT EXISTS profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         text NOT NULL,
  nickname      text,
  role          text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  is_active     boolean NOT NULL DEFAULT true,
  daily_limit   int NOT NULL DEFAULT 20,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- 自动更新 updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 新用户注册时自动创建 profile（需手动处理，或在代码中创建）

-- 2. 用量日志表
CREATE TABLE IF NOT EXISTS usage_logs (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  model      text,
  count      int NOT NULL DEFAULT 1,
  prompt     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_user_date ON usage_logs(user_id, created_at);

-- 3. 应用设置表（全局配置）
CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 插入默认全局节点设置
INSERT INTO app_settings (key, value) VALUES (
  'global_node',
  '{
    "default_model": "gpt-image-2",
    "allowed_models": ["gpt-image-2", "gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview"],
    "allowed_ratios": ["1:1", "9:16", "16:9", "3:4"],
    "max_count": 8,
    "default_style": "写实",
    "default_daily_limit": 20
  }'::jsonb
) ON CONFLICT (key) DO NOTHING;

-- 4. 用户自定义设置表（覆盖全局）
CREATE TABLE IF NOT EXISTS user_settings (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  key        text NOT NULL,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, key)
);

-- 5. 邀请码表
CREATE TABLE IF NOT EXISTS invite_codes (
  id         bigserial PRIMARY KEY,
  code       text NOT NULL UNIQUE,
  used       boolean NOT NULL DEFAULT false,
  used_by    uuid REFERENCES profiles(id),
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── RLS 行级安全策略 ──

-- profiles: 用户只能看/改自己，管理员可以看所有
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_profile" ON profiles FOR ALL USING (auth.uid() = id);
CREATE POLICY "admin_all_profiles" ON profiles FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- usage_logs: 用户只能看自己的，管理员看所有
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_logs" ON usage_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_insert_logs" ON usage_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "admin_all_logs" ON usage_logs FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- app_settings: 所有登录用户可读，只有管理员可写
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_settings" ON app_settings FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin_write_settings" ON app_settings FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- user_settings
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_user_settings" ON user_settings FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- invite_codes
ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_invite" ON invite_codes FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin_invite" ON invite_codes FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- ── 初始管理员账号 ──
-- 注意：先在 Supabase Auth 中注册你的管理员邮箱，然后执行：
-- UPDATE profiles SET role = 'admin', daily_limit = 9999 WHERE email = '你的邮箱';

-- ── 初始邀请码（测试用） ──
INSERT INTO invite_codes (code) VALUES
  ('AURA2024'), ('ADMIN001'), ('TEST1234')
ON CONFLICT (code) DO NOTHING;
