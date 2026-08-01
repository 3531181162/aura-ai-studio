// Supabase 配置 — 部署时替换为你的真实值
// 在 Vercel 环境变量中设置 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY
(function() {
  const SUPABASE_URL  = window.__SUPABASE_URL__  || 'https://ugiabovjhwtdaqfdoykh.supabase.co';
  const SUPABASE_ANON = window.__SUPABASE_ANON__ || 'sb_publishable_58CugLyhJWKCqHVGLCsugA_Abv09837';

  if (SUPABASE_URL === 'YOUR_SUPABASE_URL') {
    console.warn('[AURA] Supabase 未配置，部分功能不可用');
    window._supabase = null;
    return;
  }
  window._supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
})();

// 全局工具
window.AURA = {
  toast(msg, type = 'info') {
    const el = document.createElement('div');
    const colors = { info: '#C9A96E', success: '#50C878', error: '#E05050' };
    el.className = 'toast';
    el.style.borderColor = `${colors[type]}44`;
    el.innerHTML = `<span style="color:${colors[type]};margin-right:8px">${type==='success'?'✓':type==='error'?'✗':'◆'}</span>${msg}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  },

  async requireAuth() {
    if (!window._supabase) return null;
    const { data } = await window._supabase.auth.getSession();
    if (!data.session) { window.location.href = '/'; return null; }
    return data.session.user;
  },

  async getProfile(userId) {
    const { data } = await window._supabase
      .from('profiles').select('*').eq('id', userId).single();
    return data;
  },

  async logout() {
    await window._supabase?.auth.signOut();
    window.location.href = '/';
  }
};
