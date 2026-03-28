/// <reference types="@cloudflare/workers-types" />
import { GoogleGenAI } from "@google/genai";
import { Hono } from "hono";
import OpenAI from "openai";
import type {
  LLMAssistantTextMessage,
  LLMMessage,
  LLMProvider,
  LLMToolCall,
  LLMToolDefinition,
  LLMTurnRequest,
  LLMTurnResponse,
} from "../shared/llm.js";

type Env = {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
  AI: Ai;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatRequestBody = {
  provider?: LLMProvider;
  model?: string;
  token?: string;
  messages?: Array<ChatMessage>;
};

const app = new Hono<{ Bindings: Env }>();

const SUPPORTED_NOVA3_LANGUAGES = new Set([
  "en",
  "en-US",
  "en-AU",
  "en-GB",
  "en-IN",
  "en-NZ",
  "es",
  "es-419",
  "fr",
  "fr-CA",
  "de",
  "de-CH",
  "hi",
  "ru",
  "pt",
  "pt-BR",
  "pt-PT",
  "ja",
  "it",
  "nl",
  "multi",
]);

function normalizeNova3Language(raw: string | null) {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  if (SUPPORTED_NOVA3_LANGUAGES.has(trimmed)) return trimmed;
  const primary = trimmed.split("-")[0];
  return SUPPORTED_NOVA3_LANGUAGES.has(primary) ? primary : undefined;
}

function isProvider(value: string | undefined): value is LLMProvider {
  return value === "google" || value === "openai";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasToolCalls(
  message: LLMMessage,
): message is Extract<LLMMessage, { role: "assistant"; toolCalls: Array<LLMToolCall> }> {
  return message.role === "assistant" && "toolCalls" in message;
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

function sanitizeLLMMessages(messages: LLMTurnRequest["messages"]): Array<LLMMessage> {
  const sanitized: Array<LLMMessage> = [];

  for (const message of messages ?? []) {
    if (!isRecord(message) || typeof message.role !== "string") continue;

    if (
      (message.role === "system" || message.role === "user") &&
      typeof message.content === "string" &&
      message.content.trim()
    ) {
      sanitized.push({
        role: message.role,
        content: message.content,
      });
      continue;
    }

    if (message.role === "assistant") {
      if (
        hasToolCalls(message) &&
        Array.isArray(message.toolCalls) &&
        message.toolCalls.length > 0
      ) {
        const toolCalls = message.toolCalls
          .filter(
            (toolCall: LLMToolCall): toolCall is LLMToolCall =>
              isRecord(toolCall) &&
              typeof toolCall.id === "string" &&
              typeof toolCall.name === "string" &&
              typeof toolCall.arguments === "string" &&
              !!toolCall.name.trim(),
          )
          .map((toolCall: LLMToolCall) => ({
            id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments,
            ...(isRecord(toolCall.extraContent) &&
            isRecord(toolCall.extraContent.google) &&
            typeof toolCall.extraContent.google.thoughtSignature === "string"
              ? {
                  extraContent: {
                    google: {
                      thoughtSignature: toolCall.extraContent.google.thoughtSignature,
                    },
                  },
                }
              : {}),
          }));

        if (toolCalls.length > 0) {
          sanitized.push({
            role: "assistant",
            content: typeof message.content === "string" ? message.content : "",
            toolCalls,
          });
          continue;
        }
      }

      if (typeof message.content === "string" && message.content.trim()) {
        sanitized.push({
          role: "assistant",
          content: message.content,
        });
      }
      continue;
    }

    if (
      message.role === "tool" &&
      typeof message.toolCallId === "string" &&
      typeof message.name === "string" &&
      typeof message.content === "string"
    ) {
      sanitized.push({
        role: "tool",
        toolCallId: message.toolCallId,
        name: message.name,
        content: message.content,
      });
    }
  }

  return sanitized;
}

function sanitizeLLMTools(tools: LLMTurnRequest["tools"]): Array<LLMToolDefinition> {
  return (tools ?? []).flatMap((tool) => {
    if (
      !isRecord(tool) ||
      typeof tool.name !== "string" ||
      !tool.name.trim() ||
      typeof tool.description !== "string" ||
      !isRecord(tool.inputSchema)
    ) {
      return [];
    }

    return [
      {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
    ];
  });
}

function toolCallId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function parseToolArguments(raw: string): Record<string, unknown> {
  const normalized = raw.trim();
  if (!normalized) return {};

  try {
    const parsed = JSON.parse(normalized) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function openAiContentToText(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") {
        return "";
      }
      return part.text;
    })
    .join("");
}

function toOpenAiMessages(systemPrompt: string | undefined, messages: Array<LLMMessage>) {
  const input: Array<Record<string, unknown>> = [];

  if (systemPrompt) {
    input.push({ role: "system", content: systemPrompt });
  }

  for (const message of messages) {
    if (message.role === "system") {
      input.push({ role: "system", content: message.content });
      continue;
    }

    if (message.role === "user") {
      input.push({ role: "user", content: message.content });
      continue;
    }

    if (message.role === "assistant" && "toolCalls" in message) {
      input.push({
        role: "assistant",
        content: message.content ?? "",
        tool_calls: message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function",
          function: {
            name: toolCall.name,
            arguments: toolCall.arguments,
          },
        })),
      });
      continue;
    }

    if (message.role === "assistant") {
      input.push({ role: "assistant", content: message.content });
      continue;
    }

    input.push({
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content,
    });
  }

  return input;
}

function toGoogleContents(messages: Array<LLMMessage>) {
  const contents: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === "system") continue;

    if (message.role === "user") {
      contents.push({
        role: "user",
        parts: [{ text: message.content }],
      });
      continue;
    }

    if (message.role === "assistant" && "toolCalls" in message) {
      const parts = [
        ...(message.content?.trim() ? [{ text: message.content }] : []),
        ...message.toolCalls.map((toolCall) => ({
          ...(isRecord(toolCall.extraContent) &&
          isRecord(toolCall.extraContent.google) &&
          typeof toolCall.extraContent.google.thoughtSignature === "string"
            ? { thoughtSignature: toolCall.extraContent.google.thoughtSignature }
            : {}),
          functionCall: {
            id: toolCall.id,
            name: toolCall.name,
            args: parseToolArguments(toolCall.arguments),
          },
        })),
      ];

      contents.push({
        role: "model",
        parts,
      });
      continue;
    }

    if (message.role === "assistant") {
      contents.push({
        role: "model",
        parts: [{ text: message.content }],
      });
      continue;
    }

    contents.push({
      role: "user",
      parts: [
        {
          functionResponse: {
            id: message.toolCallId,
            name: message.name,
            response: {
              content: message.content,
            },
          },
        },
      ],
    });
  }

  return contents;
}

function extractGoogleToolCalls(response: Record<string, unknown>) {
  const firstCandidate = Array.isArray(response.candidates) ? response.candidates[0] : null;
  const content =
    isRecord(firstCandidate) && isRecord(firstCandidate.content) ? firstCandidate.content : null;
  const parts = content && Array.isArray(content.parts) ? content.parts : [];

  return parts.flatMap<LLMToolCall>((part) => {
    if (!isRecord(part) || !isRecord(part.functionCall)) return [];

    const functionCall = part.functionCall;
    if (typeof functionCall.name !== "string" || !functionCall.name.trim()) {
      return [];
    }

    const args = isRecord(functionCall.args) ? functionCall.args : {};

    return [
      {
        id:
          typeof functionCall.id === "string" && functionCall.id.trim()
            ? functionCall.id
            : toolCallId("google_call"),
        name: functionCall.name,
        arguments: JSON.stringify(args),
        ...(typeof part.thoughtSignature === "string"
          ? {
              extraContent: {
                google: {
                  thoughtSignature: part.thoughtSignature,
                },
              },
            }
          : {}),
      },
    ];
  });
}

async function generateOpenAiTurn({
  model,
  token,
  systemPrompt,
  messages,
  tools,
}: {
  model: string;
  token: string;
  systemPrompt?: string;
  messages: Array<LLMMessage>;
  tools: Array<LLMToolDefinition>;
}): Promise<LLMTurnResponse> {
  const client = new OpenAI({ apiKey: token });
  const response = await client.chat.completions.create({
    model,
    messages: toOpenAiMessages(systemPrompt, messages) as never,
    ...(tools.length
      ? {
          tools: tools.map((tool) => ({
            type: "function" as const,
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          })),
          tool_choice: "auto" as const,
        }
      : {}),
  });

  const assistant = response.choices[0]?.message;
  if (!assistant) {
    throw new Error("OpenAI did not return a message.");
  }

  const toolCalls = (assistant.tool_calls ?? []).flatMap<LLMToolCall>((toolCall) => {
    if (toolCall.type !== "function" || !toolCall.function.name) {
      return [];
    }

    return [
      {
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments ?? "{}",
      },
    ];
  });

  if (toolCalls.length > 0) {
    return {
      output: {
        type: "tool_calls",
        toolCalls,
      },
    };
  }

  const message: LLMAssistantTextMessage = {
    role: "assistant",
    content: openAiContentToText(assistant.content).trim(),
  };

  return {
    output: {
      type: "message",
      message,
    },
  };
}

async function generateGoogleTurn({
  model,
  token,
  systemPrompt,
  messages,
  tools,
}: {
  model: string;
  token: string;
  systemPrompt?: string;
  messages: Array<LLMMessage>;
  tools: Array<LLMToolDefinition>;
}): Promise<LLMTurnResponse> {
  const ai = new GoogleGenAI({ apiKey: token });
  const response = await ai.models.generateContent({
    model,
    contents: toGoogleContents(messages),
    config: {
      ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
      ...(tools.length
        ? {
            tools: [
              {
                functionDeclarations: tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  parametersJsonSchema: tool.inputSchema,
                })),
              },
            ],
          }
        : {}),
    },
  });

  const toolCalls = extractGoogleToolCalls(response as unknown as Record<string, unknown>);

  if (toolCalls.length > 0) {
    return {
      output: {
        type: "tool_calls",
        toolCalls,
      },
    };
  }

  const message: LLMAssistantTextMessage = {
    role: "assistant",
    content: response.text?.trim() ?? "",
  };

  return {
    output: {
      type: "message",
      message,
    },
  };
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

app.post("/api/llm/turn", async (c) => {
  const body = (await c.req.json().catch(() => null)) as LLMTurnRequest | null;

  if (!body || !isProvider(body.provider)) {
    return c.json({ error: "Unsupported LLM provider." }, 400);
  }

  const model = body.model?.trim();
  const token = body.token?.trim();
  const systemPrompt = body.systemPrompt?.trim();
  const messages = sanitizeLLMMessages(body.messages);
  const tools = sanitizeLLMTools(body.tools);

  if (!model || !token || !messages.length) {
    return c.json({ error: "Provider, model, token, and messages are required." }, 400);
  }

  try {
    const response =
      body.provider === "google"
        ? await generateGoogleTurn({ model, token, systemPrompt, messages, tools })
        : await generateOpenAiTurn({ model, token, systemPrompt, messages, tools });

    return c.json(response);
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : "LLM request failed.",
      },
      500,
    );
  }
});

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

app.post("/api/transcribe", async (c) => {
  const request = c.req.raw;
  if (!request.body) {
    return c.json({ error: "Audio body is required." }, 400);
  }

  const url = new URL(request.url);
  const detectLanguage = url.searchParams.get("detect_language") !== "false";
  const language = normalizeNova3Language(url.searchParams.get("language"));
  const contentType = request.headers.get("content-type")?.trim() || "audio/webm";

  try {
    const response = await c.env.AI.run(
      "@cf/deepgram/nova-3",
      {
        audio: {
          body: request.body,
          contentType,
        },
        detect_language: detectLanguage,
        ...(language ? { language } : {}),
        punctuate: true,
        smart_format: true,
      },
      { returnRawResponse: false },
    );

    const transcript =
      (
        response as {
          results?: {
            channels?: Array<{
              alternatives?: Array<{ transcript?: string }>;
            }>;
          };
        }
      )?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";

    return c.json({ transcript });
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : "Transcription failed.",
      },
      500,
    );
  }
});

app.get("/api/transcribe/ws", (c) => {
  if (c.req.header("upgrade") !== "websocket") {
    return c.json({ error: "WebSocket upgrade required." }, 426);
  }

  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];

  let language: string | undefined;
  let detectLanguage = true;
  let contentType = "audio/webm";
  let chain = Promise.resolve();

  server.accept();

  const sendPayload = (payload: Record<string, unknown>) => {
    try {
      server.send(JSON.stringify(payload));
    } catch {
      // Ignore send errors during shutdown.
    }
  };

  const normalizeContentType = (raw: string | undefined) => {
    const trimmed = raw?.trim();
    if (!trimmed) return "audio/webm";
    const base = trimmed.split(";")[0];
    if (base === "audio/webm" || base === "audio/ogg" || base === "audio/mp4") {
      return base;
    }
    return trimmed;
  };

  const enqueueTranscription = (bytes: Uint8Array) => {
    const safeContentType = normalizeContentType(contentType);
    const blob = new Blob([bytes], { type: safeContentType });

    chain = chain
      .then(async () => {
        const response = await c.env.AI.run(
          "@cf/deepgram/nova-3",
          {
            audio: {
              body: blob.stream(),
              contentType: safeContentType,
            },
            detect_language: detectLanguage,
            ...(language ? { language } : {}),
            punctuate: true,
            smart_format: true,
          },
          { returnRawResponse: false },
        );

        const transcript =
          (
            response as {
              results?: {
                channels?: Array<{
                  alternatives?: Array<{ transcript?: string }>;
                }>;
              };
            }
          )?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";

        if (transcript) {
          sendPayload({ transcript, isPartial: false });
        }
      })
      .catch((error) => {
        sendPayload({ error: error instanceof Error ? error.message : "Transcription failed." });
        try {
          server.close(1011, "Transcription failed");
        } catch {
          // ignore
        }
      });
  };

  server.addEventListener("message", (event) => {
    const data = event.data;

    if (typeof data === "string") {
      try {
        const parsed = JSON.parse(data) as {
          type?: string;
          language?: string;
          detectLanguage?: boolean;
          contentType?: string;
        };
        if (parsed.type === "config") {
          const normalized = normalizeNova3Language(parsed.language ?? null);
          if (normalized) language = normalized;
          if (typeof parsed.detectLanguage === "boolean") {
            detectLanguage = parsed.detectLanguage;
          }
          if (typeof parsed.contentType === "string" && parsed.contentType.trim()) {
            contentType = parsed.contentType.trim();
          }
          sendPayload({ ok: true });
        }
      } catch (error) {
        sendPayload({ error: error instanceof Error ? error.message : "Invalid message." });
      }
      return;
    }

    if (data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(data);
      if (bytes.byteLength > 0) enqueueTranscription(bytes);
      return;
    }

    if (data instanceof Uint8Array) {
      if (data.byteLength > 0) enqueueTranscription(data);
      return;
    }

    if (data instanceof Blob) {
      void data
        .arrayBuffer()
        .then((buffer) => {
          const bytes = new Uint8Array(buffer);
          if (bytes.byteLength > 0) enqueueTranscription(bytes);
        })
        .catch((error) => {
          sendPayload({
            error: error instanceof Error ? error.message : "Invalid audio payload.",
          });
        });
      return;
    }
  });

  server.addEventListener("close", () => {
    try {
      server.close();
    } catch {
      // ignore
    }
  });

  return new Response(null, {
    status: 101,
    webSocket: client,
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
