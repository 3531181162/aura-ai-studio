// api/generate.js — Vercel Serverless Function

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;
const API_BASE      = process.env.AI_API_BASE || 'https://api.weelinking.com';
const AI_API_KEY    = process.env.AI_API_KEY;

// 比例 → 尺寸映射
const RATIO_SIZE = {
  '1:1':  '1024x1024',
  '9:16': '1024x1792',
  '16:9': '1792x1024',
  '3:4':  '768x1024',
  '4:3':  '1024x768',
};

// 风格 → 英文 prompt 关键词
const STYLE_MAP = {
  '写实':   'photorealistic, professional studio lighting, high resolution, commercial photography',
  'realistic': 'photorealistic, professional studio lighting, high resolution, commercial photography',
  '时尚':   'fashion photography, vogue editorial style, dramatic lighting, high fashion',
  'fashion': 'fashion photography, vogue editorial style, dramatic lighting, high fashion',
  '休闲':   'casual lifestyle photography, natural daylight, relaxed and natural',
  'casual':  'casual lifestyle photography, natural daylight, relaxed and natural',
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. 验证用户 Token ──
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: '未授权，请重新登录' });

  // 用 anon key 验证用户 token
  const authCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': SUPABASE_ANON,
    }
  });
  if (!authCheck.ok) return res.status(401).json({ error: '登录已过期，请重新登录' });
  const user = await authCheck.json();
  if (!user?.id) return res.status(401).json({ error: '用户信息获取失败' });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // ── 2. 查用户权限 ──
  const { data: profile } = await supabase
    .from('profiles').select('daily_limit,is_active,role').eq('id', user.id).single();

  if (!profile || !profile.is_active)
    return res.status(403).json({ error: '账号已停用，请联系管理员' });

  const today = new Date().toISOString().split('T')[0];
  const { data: usageRows } = await supabase
    .from('usage_logs').select('count').eq('user_id', user.id).gte('created_at', today + 'T00:00:00Z');

  const usedToday = (usageRows || []).reduce((s, r) => s + (r.count || 0), 0);
  const limit = profile.daily_limit || 20;

  if (usedToday >= limit && profile.role !== 'admin')
    return res.status(429).json({ error: `今日生成已达上限（${limit}张）` });

  // ── 3. 解析参数（兼容两种字段名）──
  const body = req.body || {};
  const keyword      = body.keyword || body.prompt || '';
  const customPrompt = body.customPrompt || '';
  const style        = body.style || 'realistic';
  const model        = body.model || 'gpt-image-2';
  const ratio        = body.ratio || '1:1';
  const count        = parseInt(body.qty || body.count || 1);

  if (!keyword && !customPrompt)
    return res.status(400).json({ error: '请输入产品关键词' });

  const styleDesc = STYLE_MAP[style] || STYLE_MAP['realistic'];
  const prompt = customPrompt ||
    `Young Asian female model wearing ${keyword}. Full body product shot, white background, ${styleDesc}, 8K resolution, e-commerce main image.`;

  const size = RATIO_SIZE[ratio] || '1024x1024';
  const n = Math.min(Math.max(count, 1), 8);

  const allowedModels = ['gpt-image-2', 'gemini-3-pro-image-preview', 'gemini-3.1-flash-image-preview'];
  const safeModel = allowedModels.includes(model) ? model : 'gpt-image-2';

  // ── 4. 调用 AI API ──
  const urls = [];
  const errors = [];

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
        urls.push(item.url);
      } else if (item?.b64_json) {
        urls.push(`data:image/png;base64,${item.b64_json}`);
      }
    } catch (e) {
      errors.push(e.message);
    }
  }

  if (urls.length === 0)
    return res.status(500).json({ error: `生成失败：${errors[0] || '请检查API配置'}` });

  // ── 5. 记录用量 ──
  await supabase.from('usage_logs').insert({
    user_id: user.id,
    model: safeModel,
    count: urls.length,
    prompt: prompt.slice(0, 200),
    created_at: new Date().toISOString(),
  });

  // 返回 urls 数组（app.html 期望的格式）
  return res.status(200).json({
    urls,
    generated: urls.length,
    failed: errors.length,
    used_today: usedToday + urls.length,
    limit,
  });
};
