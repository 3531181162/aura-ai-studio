// api/generate.js

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_SVC  = process.env.SUPABASE_SERVICE_KEY;
const API_BASE      = process.env.AI_API_BASE || 'https://api.weelinking.com';
const AI_API_KEY    = process.env.AI_API_KEY;

const RATIO_SIZE = {
  '1:1':'1024x1024','9:16':'1024x1792','16:9':'1792x1024',
  '3:4':'768x1024','4:3':'1024x768',
};
const STYLE_MAP = {
  '写实':'photorealistic, professional studio lighting, commercial photography',
  'realistic':'photorealistic, professional studio lighting, commercial photography',
  '时尚':'fashion photography, vogue editorial, dramatic lighting',
  'fashion':'fashion photography, vogue editorial, dramatic lighting',
  '休闲':'casual lifestyle, natural daylight, relaxed atmosphere',
  'casual':'casual lifestyle, natural daylight, relaxed atmosphere',
};
const RES_SIZE = {
  '1K':'1024x1024','2K':'1024x1024','4K':'1024x1024',
};

// JWT 解码（不验证签名，仅取 user_id）
function decodeJWT(token) {
  try {
    const part = token.split('.')[1];
    const padded = part.replace(/-/g,'+').replace(/_/g,'/');
    return JSON.parse(Buffer.from(padded,'base64').toString('utf8'));
  } catch { return null; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error:'Method not allowed' });

  // ── 1. 解析 Token 获取 userId ──
  const token = (req.headers.authorization||'').replace('Bearer ','').trim();
  if (!token) return res.status(401).json({ error:'未授权，请重新登录' });

  const decoded = decodeJWT(token);
  if (!decoded?.sub) return res.status(401).json({ error:'无效的登录令牌' });
  const userId = decoded.sub;

  // ── 2. 用 service client 查权限 ──
  const sb = createClient(SUPABASE_URL, SUPABASE_SVC, {
    auth:{ autoRefreshToken:false, persistSession:false }
  });

  const { data: profile } = await sb
    .from('profiles').select('daily_limit,is_active,role,nickname').eq('id',userId).single();

  if (!profile || !profile.is_active)
    return res.status(403).json({ error:'账号已停用，请联系管理员' });

  const today = new Date().toISOString().split('T')[0];
  const { data: usageRows } = await sb
    .from('usage_logs').select('count').eq('user_id',userId)
    .gte('created_at', today+'T00:00:00Z');

  const usedToday = (usageRows||[]).reduce((s,r)=>s+(r.count||0),0);
  const limit = profile.daily_limit || 20;

  if (usedToday >= limit && profile.role !== 'admin')
    return res.status(429).json({ error:`今日已达上限（${limit}张）` });

  // ── 3. 解析参数 ──
  const body = req.body || {};
  const keyword     = body.keyword || body.prompt || '';
  const customPr    = body.customPrompt || '';
  const style       = body.style || 'realistic';
  const model       = body.model || 'gpt-image-2';
  const ratio       = body.ratio || '1:1';
  const resolution  = body.resolution || '1K';
  const count       = Math.min(Math.max(parseInt(body.qty||body.count||1),1),8);

  if (!keyword && !customPr)
    return res.status(400).json({ error:'请输入产品关键词' });

  const styleDesc = STYLE_MAP[style] || STYLE_MAP['realistic'];
  const prompt = customPr ||
    `Young Asian female model wearing ${keyword}. Full body, white background, ${styleDesc}, 8K, e-commerce product image.`;
  const size = RATIO_SIZE[ratio] || '1024x1024';
  const allowedModels = ['gpt-image-2','gemini-3-pro-image-preview','gemini-3.1-flash-image-preview'];
  const safeModel = allowedModels.includes(model) ? model : 'gpt-image-2';

  // ── 4. 调用 AI API ──
  const urls = [], errors = [];
  for (let i = 0; i < count; i++) {
    try {
      const r = await fetch(`${API_BASE}/v1/images/generations`, {
        method:'POST',
        headers:{ 'Authorization':`Bearer ${AI_API_KEY}`, 'Content-Type':'application/json' },
        body: JSON.stringify({ model:safeModel, prompt, n:1, size }),
        signal: AbortSignal.timeout(90000),
      });
      if (!r.ok) { const e=await r.json().catch(()=>({})); errors.push(e.error?.message||`HTTP ${r.status}`); continue; }
      const d = await r.json();
      const item = d.data?.[0];
      if (item?.url) urls.push(item.url);
      else if (item?.b64_json) urls.push(`data:image/png;base64,${item.b64_json}`);
    } catch(e) { errors.push(e.message); }
  }

  if (urls.length === 0)
    return res.status(500).json({ error:`生成失败：${errors[0]||'请检查API配置'}` });

  // ── 5. 记录用量（含图片URL）──
  await sb.from('usage_logs').insert({
    user_id:userId, model:safeModel, count:urls.length,
    prompt:prompt.slice(0,200), image_urls:urls,
    created_at:new Date().toISOString(),
  });

  return res.status(200).json({
    urls, generated:urls.length, failed:errors.length,
    used_today:usedToday+urls.length, limit,
  });
};
