import { Hono } from "hono";

type Env = {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
};

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

// Handle SPA fallback
app.get("*", async (c) => {
  const url = new URL(c.req.url);

  // Serve static assets through Cloudflare's ASSETS binding
  const assetResponse = await c.env.ASSETS.fetch(new Request(url, { method: c.req.method }));

  // If the asset is found and successful, return it
  if (assetResponse.status !== 404) {
    return assetResponse;
  }

  // Return index.html for SPA routing
  const indexResponse = await c.env.ASSETS.fetch(
    new Request(new URL("/index.html", url), { method: "GET" }),
  );

  if (indexResponse.ok) {
    return new Response(indexResponse.body, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  }

  return new Response("Not found", { status: 404 });
});

export default app;
