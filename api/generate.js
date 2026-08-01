// api/generate.js

const API_BASE   = process.env.AI_API_BASE  || 'https://api.weelinking.com';
const AI_API_KEY = process.env.AI_API_KEY;

const RATIO_SIZE = {
  '1:1':'1024x1024','9:16':'1024x1792','16:9':'1792x1024',
  '3:4':'768x1024','4:3':'1024x768',
};
const STYLE_MAP = {
  '写实':'photorealistic, professional studio lighting, commercial photography, high resolution',
  'realistic':'photorealistic, professional studio lighting, commercial photography, high resolution',
  '时尚':'fashion photography, vogue editorial, dramatic lighting, high fashion',
  'fashion':'fashion photography, vogue editorial, dramatic lighting, high fashion',
  '休闲':'casual lifestyle, natural daylight, relaxed atmosphere',
  'casual':'casual lifestyle, natural daylight, relaxed atmosphere',
};

// 简单 JWT 解码（只取 payload，不验签）
function decodeJWT(token) {
  try {
    const part = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    return JSON.parse(Buffer.from(part,'base64').toString('utf8'));
  } catch { return null; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error:'Method not allowed' });

  // ── 1. 验证 Token（只要能解码就通过）──
  const token = (req.headers.authorization||'').replace('Bearer ','').trim();
  if (!token) return res.status(401).json({ error:'未授权，请重新登录' });
  const decoded = decodeJWT(token);
  if (!decoded?.sub) return res.status(401).json({ error:'登录令牌无效，请退出重新登录' });

  // ── 2. 解析生成参数 ──
  const body        = req.body || {};
  const keyword     = body.keyword || body.prompt || '';
  const customPr    = body.customPrompt || '';
  const style       = body.style || 'realistic';
  const model       = body.model || 'gpt-image-2';
  const ratio       = body.ratio || '1:1';
  const count       = Math.min(Math.max(parseInt(body.qty||body.count||1),1),8);

  if (!keyword && !customPr)
    return res.status(400).json({ error:'请输入产品关键词' });

  const styleDesc = STYLE_MAP[style] || STYLE_MAP['realistic'];
  const prompt    = customPr ||
    `Young Asian female model wearing ${keyword}. Full body product shot, clean white background, ${styleDesc}, 8K resolution, e-commerce main image.`;
  const size      = RATIO_SIZE[ratio] || '1024x1024';
  const allowedModels = ['gpt-image-2','gemini-3-pro-image-preview','gemini-3.1-flash-image-preview'];
  const safeModel = allowedModels.includes(model) ? model : 'gpt-image-2';

  // ── 3. 调用 AI API ──
  const urls = [], errors = [];
  for (let i = 0; i < count; i++) {
    try {
      const r = await fetch(`${API_BASE}/v1/images/generations`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model:safeModel, prompt, n:1, size }),
        signal: AbortSignal.timeout(90000),
      });

      if (!r.ok) {
        const e = await r.json().catch(()=>({}));
        errors.push(e.error?.message || `HTTP ${r.status}`);
        continue;
      }

      const d    = await r.json();
      const item = d.data?.[0];
      if (item?.url)       urls.push(item.url);
      else if (item?.b64_json) urls.push(`data:image/png;base64,${item.b64_json}`);
    } catch(e) { errors.push(e.message); }
  }

  if (urls.length === 0)
    return res.status(500).json({ error:`生成失败：${errors[0] || 'AI接口无响应，请稍后重试'}` });

  return res.status(200).json({
    urls,
    generated: urls.length,
    failed:    errors.length,
    used_today: 1,
    limit:      9999,
  });
};
