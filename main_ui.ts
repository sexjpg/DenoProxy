// 打开 Deno KV（全局只需打开一次）
const kv = await Deno.openKv();
// 使用一个固定的 key 来存储目标 URL
const TARGET_KEY = ["targetUrl"];

// 生成主页 HTML 的辅助函数
function getHomepageHtml(
  { currentTarget, newTarget, error, baseHost }:
  { currentTarget?: string; newTarget?: string; error?: string; baseHost: string }
) {
  let statusMessage = "";
  if (error) {
    statusMessage = `<p style="color: red;"><b>错误：</b>${error}</p>`;
  } else if (newTarget) {
    const proxyUrl = `${baseHost}/proxy`;
    statusMessage = `
      <p style="color: green;"><b>代理设置成功！</b></p>
      <p>当前代理目标：<code>${newTarget}</code></p>
      <p>点击下面的链接开始访问：<br/>
        <a href="/proxy" target="_blank">${proxyUrl}</a>
      </p>
    `;
  } else if (currentTarget) {
    statusMessage = `<p>当前代理目标：<code>${currentTarget}</code></p>`;
  }

  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Deno 代理设置</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 2em auto; padding: 0 1em; line-height: 1.6; }
        h1 { text-align: center; }
        form { display: flex; gap: 0.5em; margin-bottom: 1em; }
        input[type="url"] { flex-grow: 1; padding: 0.5em; border: 1px solid #ccc; border-radius: 4px; }
        button { padding: 0.5em 1em; border: none; background-color: #007bff; color: white; border-radius: 4px; cursor: pointer; }
        button:hover { background-color: #0056b3; }
        #status { background-color: #f0f0f0; padding: 1em; border-radius: 4px; }
        code { background-color: #e0e0e0; padding: 0.2em 0.4em; border-radius: 3px; }
        a { color: #007bff; }
      </style>
    </head>
    <body>
      <h1>设置代理目标网址</h1>
      <p>输入您想代理的完整 URL (例如 https://example.com)，然后点击“设置”。</p>
      <form action="/" method="GET">
        <input type="url" name="setUrl" placeholder="https://aistudio.google.com" required>
        <button type="submit">设置</button>
      </form>
      <div id="status">
        ${statusMessage || '<p>尚未设置代理目标。</p>'}
      </div>
    </body>
    </html>
  `;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const baseHost = `https://${url.host}`; // 构造基础域名，用于显示

  // 1. 主页和表单处理
  if (url.pathname === "/") {
    const newTargetUrl = url.searchParams.get("setUrl");

    // 如果是通过表单提交了新 URL
    if (newTargetUrl) {
      try {
        new URL(newTargetUrl); // 验证 URL 格式
        await kv.set(TARGET_KEY, newTargetUrl);
        const html = getHomepageHtml({ newTarget: newTargetUrl, baseHost });
        return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      } catch {
        const html = getHomepageHtml({ error: "无效的 URL，请检查格式。", baseHost });
        return new Response(html, { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
    }

    // 如果是直接访问主页，显示当前设置
    const result = await kv.get(TARGET_KEY);
    const currentTarget = result.value as string | undefined;
    const html = getHomepageHtml({ currentTarget, baseHost });
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  // 2. 代理核心逻辑 (保持不变)
  if (url.pathname.startsWith("/proxy")) {
    const result = await kv.get(TARGET_KEY);
    if (!result.value) {
      return new Response(
        "未设置代理目标 URL，请先返回首页进行设置。",
        { status: 400 }
      );
    }
    const baseUrl = result.value as string;
    const proxyPath = url.pathname.slice("/proxy".length);
    
    let finalUrl: string;
    try {
      finalUrl = new URL(proxyPath + url.search, baseUrl).toString();
    } catch {
      return new Response("构造目标 URL 出错。", { status: 500 });
    }

    const proxyRequest = new Request(finalUrl, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });

    try {
      const targetResponse = await fetch(proxyRequest);
      const body = await targetResponse.arrayBuffer();
      const responseHeaders = new Headers(targetResponse.headers);
      return new Response(body, {
        status: targetResponse.status,
        headers: responseHeaders,
      });
    } catch (err) {
      return new Response(`请求目标 URL 时发生错误：${err.message}`, {
        status: 502, // Bad Gateway 更合适
      });
    }
  }

  // 3. 其他所有未知路径，重定向到主页
  return Response.redirect(url.origin, 302);
});
