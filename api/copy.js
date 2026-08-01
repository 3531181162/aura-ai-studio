// api/copy.js — 文案生成接口

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

  const token = (req.headers.authorization||'').replace('Bearer ','').trim();
  if (!token) return res.status(401).json({ error:'未授权' });
  const decoded = decodeJWT(token);
  if (!decoded?.sub) return res.status(401).json({ error:'无效令牌' });

  const { product, features, price, platform='淘宝', style='简洁' } = req.body || {};
  if (!product) return res.status(400).json({ error:'请填写产品名称' });

  const API_BASE   = process.env.AI_API_BASE || 'https://api.weelinking.com';
  const AI_API_KEY = process.env.AI_API_KEY;

  const sysPrompt = `你是专业电商文案写手，擅长${platform}平台的服装/工装类产品文案。只输出JSON，不要其他内容。`;
  const userPrompt = `产品：${product}\n特点：${features||'无'}\n价格：${price||'未知'}元\n平台：${platform}\n风格：${style}\n\n输出JSON格式：{"title":"主图标题20字内","bullets":["卖点1","卖点2","卖点3","卖点4","卖点5"],"detail":"详情页首屏文案100字","tags":["标签1","标签2","标签3"]}`;

  try {
    const r = await fetch(`${API_BASE}/v1/chat/completions`, {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${AI_API_KEY}`, 'Content-Type':'application/json' },
      body: JSON.stringify({
        model:'gpt-4o-mini',
        messages:[{ role:'system', content:sysPrompt },{ role:'user', content:userPrompt }],
        temperature:0.8, max_tokens:600,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const content = d.choices?.[0]?.message?.content || '';
    const match = content.match(/\{[\s\S]*\}/);
    const result = match ? JSON.parse(match[0]) : { title:product, bullets:[], detail:content, tags:[] };
    return res.status(200).json(result);
  } catch(e) {
    // 降级：本地模板
    return res.status(200).json({
      title:`${product} | ${features?.split(/[，,]/)[0]||'精品'}热卖款`,
      bullets:[`✓ ${features||'品质保障'}`,`✓ 售价${price||'优惠'}元起`,`✓ 多色多码可选`,`✓ 工厂直供`,`✓ 7天退换`],
      detail:`【${product}】${features||''}，专为${platform}电商设计，性价比极高，支持批量定制。`,
      tags:[product, platform, '爆款'],
    });
  }
};
