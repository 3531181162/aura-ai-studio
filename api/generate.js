// api/generate.js — Vercel Serverless Function
// 图片生成接口，保护 API Key 不暴露给前端

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;  // 服务端 key，有写权限
const API_BASE      = process.env.AI_API_BASE || 'https://api.weelinking.com';
const AI_API_KEY    = process.env.AI_API_KEY;            // 管理员 API Key

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. 验证用户 Token ──
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '未授权' });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: '登录已过期，请重新登录' });

  // ── 2. 查用户权限和今日用量 ──
  const { data: profile } = await supabase
    .from('profiles').select('daily_limit,is_active,role').eq('id', user.id).single();

  if (!profile || !profile.is_active)
    return res.status(403).json({ error: '账号已停用，请联系管理员' });

  // 查今日已用次数（按生成总张数）
  const today = new Date().toISOString().split('T')[0];
  const { data: usageRows } = await supabase
    .from('usage_logs')
    .select('count')
    .eq('user_id', user.id)
    .gte('created_at', today + 'T00:00:00Z');

  const usedToday = (usageRows || []).reduce((s, r) => s + (r.count || 0), 0);
  const limit = profile.daily_limit || 20;

  if (usedToday >= limit && profile.role !== 'admin')
    return res.status(429).json({ error: `今日生成已达上限（${limit}张），请联系管理员提额` });

  // ── 3. 解析请求参数 ──
  const {
    prompt  = '',
    model   = 'gpt-image-2',
    count   = 1,
    size    = '1024x1024',
  } = req.body || {};

  if (!prompt || prompt.trim().length < 2)
    return res.status(400).json({ error: '提示词不能为空' });

  const n = Math.min(Math.max(parseInt(count) || 1, 1), 8);

  // ── 4. 调用 AI API ──
  const allowedModels = ['gpt-image-2', 'gemini-3-pro-image-preview', 'gemini-3.1-flash-image-preview'];
  const safeModel = allowedModels.includes(model) ? model : 'gpt-image-2';

  const results = [];
  const errors  = [];

  for (let i = 0; i < n; i++) {
    try {
      const aiRes = await fetch(`${API_BASE}/v1/images/generations`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: safeModel, prompt, n: 1, size }),
        signal: AbortSignal.timeout(90000),
      });

      if (!aiRes.ok) {
        const err = await aiRes.json().catch(() => ({}));
        errors.push(err.error?.message || `HTTP ${aiRes.status}`);
        continue;
      }

      const data = await aiRes.json();
      const item = data.data?.[0];
      if (item?.url) {
        results.push({ url: item.url, type: 'url' });
      } else if (item?.b64_json) {
        results.push({ b64: item.b64_json, type: 'b64' });
      }
    } catch(e) {
      errors.push(e.message);
    }
  }

  if (results.length === 0)
    return res.status(500).json({ error: `生成失败：${errors[0] || '未知错误'}` });

  // ── 5. 记录用量 ──
  await supabase.from('usage_logs').insert({
    user_id:    user.id,
    model:      safeModel,
    count:      results.length,
    prompt:     prompt.slice(0, 200),
    created_at: new Date().toISOString(),
  });

  return res.status(200).json({
    images:    results,
    generated: results.length,
    failed:    errors.length,
    used_today: usedToday + results.length,
    limit,
  });
};
