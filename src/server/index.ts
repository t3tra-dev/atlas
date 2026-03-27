import { GoogleGenAI } from "@google/genai";
import { Hono } from "hono";
import OpenAI from "openai";

type Env = {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
};

type LlmProvider = "google" | "openai";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatRequestBody = {
  provider?: LlmProvider;
  model?: string;
  token?: string;
  messages?: Array<ChatMessage>;
};

const app = new Hono<{ Bindings: Env }>();

function isProvider(value: string | undefined): value is LlmProvider {
  return value === "google" || value === "openai";
}

function sanitizeMessages(messages: ChatRequestBody["messages"]) {
  return (messages ?? []).filter(
    (message): message is ChatMessage =>
      !!message &&
      (message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string" &&
      !!message.content.trim(),
  );
}

function createSseStream(
  streamWriter: (
    send: (
      event: "delta" | "done" | "error" | "ready",
      payload: Record<string, string>,
    ) => Promise<void>,
  ) => Promise<void>,
) {
  const encoder = new TextEncoder();

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  void (async () => {
    const send = async (
      event: "delta" | "done" | "error" | "ready",
      payload: Record<string, string>,
    ) => {
      await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
    };

    try {
      await send("ready", {});
      await streamWriter(send);
      await send("done", {});
    } catch (error) {
      const message = error instanceof Error ? error.message : "LLM request failed.";
      await send("error", { error: message });
    } finally {
      await writer.close();
    }
  })();

  return readable;
}

async function streamGoogleChat(
  model: string,
  token: string,
  messages: Array<ChatMessage>,
  send: (
    event: "delta" | "done" | "error" | "ready",
    payload: Record<string, string>,
  ) => Promise<void>,
) {
  const ai = new GoogleGenAI({ apiKey: token });
  const contents = messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));

  const response = await ai.models.generateContentStream({
    model,
    contents,
  });

  for await (const chunk of response) {
    const delta = chunk.text;
    if (!delta) continue;
    await send("delta", { delta });
  }
}

async function streamOpenAiChat(
  model: string,
  token: string,
  messages: Array<ChatMessage>,
  send: (
    event: "delta" | "done" | "error" | "ready",
    payload: Record<string, string>,
  ) => Promise<void>,
) {
  const client = new OpenAI({ apiKey: token });
  const completion = await client.responses.create({
    model,
    stream: true,
    input: messages.map((message) => ({
      type: "message",
      role: message.role,
      content: message.content,
    })),
  });

  for await (const chunk of completion) {
    if (chunk.type !== "response.output_text.delta") continue;
    const delta = chunk.delta;
    if (!delta) continue;
    await send("delta", { delta });
  }
}

app.get("/api/health", (c) => c.json({ ok: true }));

app.post("/api/llm/chat", async (c) => {
  const body = (await c.req.json().catch(() => null)) as ChatRequestBody | null;

  if (!body || !isProvider(body.provider)) {
    return c.json({ error: "Unsupported LLM provider." }, 400);
  }

  const model = body.model?.trim();
  const token = body.token?.trim();
  const messages = sanitizeMessages(body.messages);

  if (!model || !token || !messages.length) {
    return c.json({ error: "Provider, model, token, and messages are required." }, 400);
  }

  const stream = createSseStream(async (send) => {
    if (body.provider === "google") {
      await streamGoogleChat(model, token, messages, send);
      return;
    }

    await streamOpenAiChat(model, token, messages, send);
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

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
