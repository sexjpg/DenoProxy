import { serve } from "https://deno.land/std@0.182.0/http/server.ts";

// 默认配置
let config = {
  targetHost: "generativelanguage.googleapis.com",
  hostHeader: "generativelanguage.googleapis.com",
  originHeader: "https://generativelanguage.googleapis.com",
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  accessControlAllowOrigin: "*",
};

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

// 返回配置页面的HTML
function getUiContent(): string {
  return `
  <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gemini 代理配置</title>
    <style>
      body { font-family: sans-serif; line-height: 1.6; padding: 20px; max-width: 600px; margin: auto; }
      h1, h2 { text-align: center; }
      form { display: flex; flex-direction: column; gap: 15px; }
      label { font-weight: bold; }
      input[type="text"] { padding: 8px; border: 1px solid #ccc; border-radius: 4px; }
      button { padding: 10px 15px; border: none; background-color: #007bff; color: white; border-radius: 4px; cursor: pointer; }
      button:hover { background-color: #0056b3; }
      .status { background-color: #f0f0f0; padding: 10px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <h1>Gemini 代理配置</h1>
    <div class="status">
      <h2>当前配置</h2>
      <p><strong>目标地址 (Target Host):</strong> ${config.targetHost}</p>
    </div>
    <br>
    <form action="/config" method="post">
      <label for="targetHost">目标地址 (TARGET_HOST):</label>
      <input type="text" id="targetHost" name="targetHost" value="${config.targetHost}" required>

      <label for="hostHeader">Host 头:</label>
      <input type="text" id="hostHeader" name="hostHeader" value="${config.hostHeader}" required>

      <label for="originHeader">Origin 头:</label>
      <input type="text" id="originHeader" name="originHeader" value="${config.originHeader}" required>

      <label for="userAgent">User-Agent:</label>
      <input type="text" id="userAgent" name="userAgent" value="${config.userAgent}" required>
      
      <label for="accessControlAllowOrigin">Access-Control-Allow-Origin:</label>
      <input type="text" id="accessControlAllowOrigin" name="accessControlAllowOrigin" value="${config.accessControlAllowOrigin}" required>

      <button type="submit">更新配置</button>
    </form>
  </body>
  </html>
  `;
}

// 根据当前配置转换请求头
function transformHeaders(headers: Headers): Headers {
  const newHeaders = new Headers();
  for (const [key, value] of headers.entries()) {
    newHeaders.set(key, value);
  }
  newHeaders.set("User-Agent", config.userAgent);
  newHeaders.set("Host", config.hostHeader);
  newHeaders.set("Origin", config.originHeader);
  return newHeaders;
}

// 处理 WebSocket 请求
async function handleWebSocket(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const targetUrl = `wss://${config.targetHost}${url.pathname}${url.search}`;
  log(`建立 WebSocket 连接: ${targetUrl}`);
  
  const { socket: clientSocket, response } = Deno.upgradeWebSocket(req);
  try {
    const serverSocket = new WebSocket(targetUrl);

    clientSocket.onmessage = (event) => {
      if (serverSocket.readyState === WebSocket.OPEN) serverSocket.send(event.data);
    };
    serverSocket.onmessage = (event) => {
      if (clientSocket.readyState === WebSocket.OPEN) clientSocket.send(event.data);
    };
    clientSocket.onclose = () => {
      if (serverSocket.readyState === WebSocket.OPEN) serverSocket.close();
    };
    serverSocket.onclose = () => {
      if (clientSocket.readyState === WebSocket.OPEN) clientSocket.close();
    };
    clientSocket.onerror = (e) => log(`客户端 WebSocket 错误: ${e}`);
    serverSocket.onerror = (e) => log(`服务端 WebSocket 错误: ${e}`);

    return response;
  } catch (error) {
    log(`WebSocket 连接错误: ${error.message}`);
    return new Response(`WebSocket 错误: ${error.message}`, { status: 500 });
  }
}

// 处理 HTTP 代理请求
async function handleProxyRequest(req: Request): Promise<Response> {
  try {
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return await handleWebSocket(req);
    }

    const url = new URL(req.url);
    const targetUrl = `https://${config.targetHost}${url.pathname}${url.search}`;
    log(`代理 HTTP 请求: ${targetUrl}`);

    const proxyReq = new Request(targetUrl, {
      method: req.method,
      headers: transformHeaders(req.headers),
      body: req.body,
      redirect: "follow",
    });

    const response = await fetch(proxyReq);
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", config.accessControlAllowOrigin);
    responseHeaders.set("Access-Control-Allow-Credentials", "true");


    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    log(`错误: ${error.message}`);
    return new Response(`代理错误: ${error.message}`, { status: 500 });
  }
}

// 主请求处理器
async function mainHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/" && req.method === "GET") {
    return new Response(getUiContent(), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (url.pathname === "/config" && req.method === "POST") {
    try {
      const formData = await req.formData();
      config.targetHost = formData.get("targetHost") as string || config.targetHost;
      config.hostHeader = formData.get("hostHeader") as string || config.hostHeader;
      config.originHeader = formData.get("originHeader") as string || config.originHeader;
      config.userAgent = formData.get("userAgent") as string || config.userAgent;
      config.accessControlAllowOrigin = formData.get("accessControlAllowOrigin") as string || config.accessControlAllowOrigin;
      
      log("配置已更新: " + JSON.stringify(config));
      return Response.redirect(req.headers.get("Referer") || "/", 303);
    } catch (error) {
      log(`配置更新错误: ${error.message}`);
      return new Response("更新配置失败", { status: 400 });
    }
  }

  return handleProxyRequest(req);
}

// 启动服务器
async function startServer(port: number) {
  log(`代理服务器启动于端口 ${port}`);
  await serve(mainHandler, {
    port,
    onListen: () => {
      log(`服务正在监听 http://localhost:${port}`);
      log('请访问 http://localhost:8080/ 进行配置')
    },
  });
}

if (import.meta.main) {
  const port = 8080;
  startServer(port);
}
