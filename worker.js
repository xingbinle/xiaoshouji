/* ============================================
   小手机 Cloudflare Worker 代理
   作用：把月月的 API Key 藏在 Worker 里，前端代码完全看不到
   部署方法：登录 Cloudflare → Workers → 创建 → 粘贴这段代码 → 部署
   ============================================ */

// ============ 配置区域 ============
// 在 Cloudflare Worker 的 Settings → Variables 里配置：
//   API_KEY:   你的 OpenAI 兼容 API Key（如 sk-xxx）
//   BASE_URL:  API 完整地址（不带末尾斜杠），如 https://api.example.com/v1
//   ALLOWED_ORIGIN: 允许访问的来源（可选，留空则允许所有）

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env) {
    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // 健康检查
    if (path === '/' || path === '/health') {
      return jsonResponse({ status: 'ok', service: '小手机 Worker' });
    }

    // 检查环境变量
    const apiKey = env.API_KEY;
    const baseUrl = env.BASE_URL;

    if (!apiKey || !baseUrl) {
      return jsonResponse({
        error: 'Worker 未配置 API_KEY 和 BASE_URL，请在 Cloudflare 后台设置。',
      }, 500);
    }

    try {
      // 转发 /v1/* 到真实 API
      if (path.startsWith('/v1/')) {
        const targetPath = path.replace(/^\/v1/, '');
        const targetUrl = baseUrl.replace(/\/$/, '') + targetPath + url.search;

        const headers = new Headers();
        headers.set('Authorization', `Bearer ${apiKey}`);
        headers.set('Content-Type', request.headers.get('Content-Type') || 'application/json');

        // 透传其他必要 header
        const passthrough = ['anthropic-version', 'anthropic-dangerous-direct-browser-access'];
        passthrough.forEach((h) => {
          const v = request.headers.get(h);
          if (v) headers.set(h, v);
        });

        const resp = await fetch(targetUrl, {
          method: request.method,
          headers,
          body: request.method !== 'GET' ? await request.body : undefined,
        });

        // 把上游响应透传回去
        const respHeaders = new Headers(resp.headers);
        Object.entries(CORS_HEADERS).forEach(([k, v]) => respHeaders.set(k, v));
        return new Response(resp.body, {
          status: resp.status,
          statusText: resp.statusText,
          headers: respHeaders,
        });
      }

      return jsonResponse({ error: '未知路径：' + path }, 404);
    } catch (e) {
      return jsonResponse({ error: 'Worker 错误：' + e.message }, 500);
    }
  },
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}