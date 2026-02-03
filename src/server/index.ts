import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import path from "node:path";
import fs from "node:fs";
import type { Socket } from "node:net";

const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true }));

const distDir = path.resolve(process.cwd(), "dist");

app.use("/*", serveStatic({ root: distDir }));

// SPA fallback（React Router等で 404 を index.html に返す）
app.get("*", (c) => {
  const indexHtml = path.join(distDir, "index.html");
  if (fs.existsSync(indexHtml)) {
    const html = fs.readFileSync(indexHtml, "utf-8");
    c.header("Content-Type", "text/html; charset=utf-8");
    return c.body(html);
  }
  return c.text("dist/index.html not found.", 500);
});

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port });
console.log(`\ndev server started at http://localhost:${port}`);

const sockets = new Set<Socket>();
server.on("connection", (socket: Socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});

let shuttingDown = false;

const cleanupStdin = () => {
  if (!process.stdin.isTTY) return;
  try {
    process.stdin.setRawMode(false);
  } catch {
    // ignore
  }
  try {
    process.stdin.pause();
  } catch {
    // ignore
  }
};

const shutdown = (reason: string) => {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\nShutting down (${reason})...`);
  cleanupStdin();

  for (const socket of sockets) {
    try {
      socket.destroy();
    } catch {
      // ignore
    }
  }
  sockets.clear();

  const forceExit = setTimeout(() => process.exit(0), 250);
  try {
    server.close(() => {
      clearTimeout(forceExit);
      process.exit(0);
    });
  } catch {
    process.exit(0);
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

if (process.env.DEV_KEYBINDS === "1" && process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();

  process.stdin.on("data", (chunk) => {
    const key = chunk.toString("utf8");
    if (key === "q") shutdown("q");
    if (key === "\u0003") shutdown("Ctrl+C");
  });
}
