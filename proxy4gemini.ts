import { parse } from "https://deno.land/std@0.182.0/flags/mod.ts";
import { serve } from "https://deno.land/std@0.182.0/http/server.ts";

const DEFAULT_PORT = 8080;
const TARGET_HOST = "generativelanguage.googleapis.com";

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function getDefaultUserAgent(isMobile: boolean = false): string {
  if (isMobile) {
    return "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  } else {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  }
}

function transformHeaders(headers: Headers): Headers {
  const isMobile = headers.get("sec-ch-ua-mobile") === "?1";
  const newHeaders = new Headers();
  for (const [key, value] of headers.entries()) {
    newHeaders.set(key, value);
  }
  newHeaders.set("User-Agent", getDefaultUserAgent(isMobile));
  newHeaders.set("Host", TARGET_HOST);
  newHeaders.set("Origin", `https://${TARGET_HOST}`);
  return newHeaders;
}

async function handleWebSocket(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const targetUrl = `wss://${TARGET_HOST}${url.pathname}${url.search}`;
  log(`Establishing WebSocket connection to: ${targetUrl}`);
  const { socket: clientSocket, response } = Deno.upgradeWebSocket(req);
  try {
    const serverSocket = new WebSocket(targetUrl);

    clientSocket.onmessage = (event) => {
      if (serverSocket.readyState === WebSocket.OPEN) {
        serverSocket.send(event.data);
      }
    };

    serverSocket.onmessage = (event) => {
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(event.data);
      }
    };

    clientSocket.onerror = (error) => {
      log(`Client WebSocket error: ${error}`);
    };
    serverSocket.onerror = (error) => {
      log(`Server WebSocket error: ${error}`);
    };

    clientSocket.onclose = () => {
      if (serverSocket.readyState === WebSocket.OPEN) {
        serverSocket.close();
      }
    };
    serverSocket.onclose = () => {
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.close();
      }
    };
    return response;
  } catch (error) {
    log(`WebSocket connection error: ${error.message}`);
    return new Response(`WebSocket Error: ${error.message}`, { status: 500 });
  }
}

async function handleRequest(req: Request): Promise<Response> {
  try {
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return await handleWebSocket(req);
    }

    const url = new URL(req.url);
    const targetUrl = `https://${TARGET_HOST}${url.pathname}${url.search}`;
    log(`Proxying HTTP request: ${targetUrl}`);

    const proxyReq = new Request(targetUrl, {
      method: req.method,
      headers: transformHeaders(req.headers),
      body: req.body,
      redirect: "follow",
    });
    const response = await fetch(proxyReq);
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    log(`Error: ${error.message}`);
    return new Response(`Proxy Error: ${error.message}`, { status: 500 });
  }
}

async function startServer(port: number) {
  log(`Starting proxy server on port ${port}`);
  await serve(handleRequest, {
    port,
    onListen: () => {
      log(`Listening on http://localhost:${port}`);
    },
  });
}

if (import.meta.main) {
  const { args } = Deno;
  const parsedArgs = parse(args);
  const port = parsedArgs.port ? Number(parsedArgs.port) : DEFAULT_PORT;
  startServer(port);
}
