/**
 * Based on humanize-cdp (https://github.com/pip-owl/humanize-cdp)
 *
 * MIT License
 *
 * Copyright (c) the humanize-cdp authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import type { Server, ServerWebSocket } from "bun";
import { config } from "./config";
import { enqueueKeyboard, handleKeyEvent } from "./keyboard";
import {
  enqueueMouse,
  handleMouseEvent,
  injectedWaiters,
  sendToTarget,
} from "./mouse";
import type { CdpMessage, WsData } from "./types";

// ─── HTTP URL rewriting ───────────────────────────────────────────────────────

function rewriteDebuggerUrls(data: unknown, proxyHost: string): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => rewriteDebuggerUrls(item, proxyHost));
  }
  if (data !== null && typeof data === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (key === "webSocketDebuggerUrl" && typeof value === "string") {
        try {
          const u = new URL(value);
          const scheme = u.protocol === "wss:" ? "wss" : "ws";
          out[key] = `${scheme}://${proxyHost}${u.pathname}${u.search}`;
        } catch {
          out[key] = value;
        }
      } else {
        out[key] = rewriteDebuggerUrls(value, proxyHost);
      }
    }
    return out;
  }
  return data;
}

async function proxyHttp(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const targetUrl = `${config.targetBase.origin}${url.pathname}${url.search}`;

  const headers = new Headers(req.headers);
  headers.set("host", config.targetBase.host);
  headers.delete("connection");

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
  };

  if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
    init.body = req.body;
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`Bad gateway: ${message}`, { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  const proxyHost = req.headers.get("host") ?? `localhost:${config.port}`;

  if (contentType.includes("json") || url.pathname.startsWith("/json")) {
    const text = await upstream.text();
    let body = text;
    try {
      const parsed: unknown = JSON.parse(text);
      body = JSON.stringify(rewriteDebuggerUrls(parsed, proxyHost));
    } catch {
      // non-JSON body under /json — leave as-is
    }

    const outHeaders = new Headers();
    outHeaders.set("content-type", contentType || "application/json");
    return new Response(body, { status: upstream.status, headers: outHeaders });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers,
  });
}

// ─── WebSocket bridging ───────────────────────────────────────────────────────

function handleClientMessage(ws: ServerWebSocket<WsData>, raw: string): void {
  const data = ws.data;

  if (!data.ready) {
    data.buffer.push(raw);
    return;
  }

  let msg: CdpMessage;
  try {
    msg = JSON.parse(raw) as CdpMessage;
  } catch {
    data.target?.send(raw);
    return;
  }

  if (msg.method === "Input.dispatchMouseEvent") {
    enqueueMouse(data, () => handleMouseEvent(data, msg));
    return;
  }

  if (msg.method === "Input.dispatchKeyEvent" && config.keyboardHumanize) {
    enqueueKeyboard(data, () => handleKeyEvent(data, msg));
    return;
  }

  sendToTarget(data, msg);
}

function handleTargetMessage(ws: ServerWebSocket<WsData>, raw: string): void {
  const data = ws.data;

  let msg: CdpMessage;
  try {
    msg = JSON.parse(raw) as CdpMessage;
  } catch {
    if (ws.readyState === WebSocket.OPEN) ws.send(raw);
    return;
  }

  if (typeof msg.id === "number" && data.pendingInjected.has(msg.id)) {
    data.pendingInjected.delete(msg.id);
    const waiter = injectedWaiters.get(msg.id);
    if (waiter) {
      injectedWaiters.delete(msg.id);
      waiter(
        msg.result && typeof msg.result === "object"
          ? (msg.result as Record<string, unknown>)
          : null,
      );
    }
    // Eat injected response — do not forward to client
    return;
  }

  if (ws.readyState === WebSocket.OPEN) ws.send(raw);
}

function connectTarget(ws: ServerWebSocket<WsData>): void {
  const data = ws.data;
  const targetUrl = `${config.targetWsOrigin}${data.path}`;
  const target = new WebSocket(targetUrl);
  data.target = target;

  target.addEventListener("open", () => {
    data.ready = true;
    for (const buffered of data.buffer) {
      handleClientMessage(ws, buffered);
    }
    data.buffer = [];
  });

  target.addEventListener("message", (event) => {
    const raw =
      typeof event.data === "string"
        ? event.data
        : new TextDecoder().decode(event.data as ArrayBuffer);
    handleTargetMessage(ws, raw);
  });

  target.addEventListener("close", (event) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(event.code, event.reason);
    }
  });

  target.addEventListener("error", () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1011, "target error");
    }
  });
}

// ─── Server ───────────────────────────────────────────────────────────────────

const clients = new Set<ServerWebSocket<WsData>>();

const server: Server<WsData> = Bun.serve({
  port: config.port,
  fetch(req, srv) {
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const url = new URL(req.url);
      const ok = srv.upgrade(req, {
        data: {
          path: url.pathname + url.search,
          target: null,
          ready: false,
          buffer: [],
          lastX: 0,
          lastY: 0,
          hasPosition: false,
          buttons: 0,
          pressForwardedAt: null,
          nextInjectedId: config.injectedIdStart,
          pendingInjected: new Set(),
          mouseTail: Promise.resolve(),
          keyboardTail: Promise.resolve(),
          pendingWordPause: false,
          viewportW: 1280,
          viewportH: 720,
          hasViewport: false,
        } satisfies WsData,
      });
      if (!ok) {
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return undefined;
    }

    return proxyHttp(req);
  },
  websocket: {
    data: {} as WsData,

    open(ws) {
      clients.add(ws);
      connectTarget(ws);
    },

    message(ws, message) {
      const raw =
        typeof message === "string"
          ? message
          : new TextDecoder().decode(message);
      handleClientMessage(ws, raw);
    },

    close(ws) {
      clients.delete(ws);
      const target = ws.data.target;
      if (target && target.readyState === WebSocket.OPEN) {
        target.close();
      }
      ws.data.target = null;
    },
  },
});

console.error(
  `humanize-cdp listening on :${server.port} → ${config.cdpTarget}`,
);

// ─── Clean exit ───────────────────────────────────────────────────────────────

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`received ${signal}, closing connections…`);

  for (const ws of clients) {
    try {
      ws.data.target?.close(1001, "proxy shutting down");
    } catch {
      /* ignore */
    }
    try {
      ws.close(1001, "proxy shutting down");
    } catch {
      /* ignore */
    }
  }
  clients.clear();
  server.stop(true);
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
