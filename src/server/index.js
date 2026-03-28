/// <reference types="@cloudflare/workers-types" />
import { GoogleGenAI } from "@google/genai";
import { Hono } from "hono";
import OpenAI from "openai";
const app = new Hono();
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
function normalizeNova3Language(raw) {
    const trimmed = raw?.trim();
    if (!trimmed)
        return undefined;
    if (SUPPORTED_NOVA3_LANGUAGES.has(trimmed))
        return trimmed;
    const primary = trimmed.split("-")[0];
    return SUPPORTED_NOVA3_LANGUAGES.has(primary) ? primary : undefined;
}
function isProvider(value) {
    return value === "google" || value === "openai";
}
function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
function hasToolCalls(message) {
    return message.role === "assistant" && "toolCalls" in message;
}
function sanitizeMessages(messages) {
    return (messages ?? []).filter((message) => !!message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        !!message.content.trim());
}
function sanitizeLLMMessages(messages) {
    const sanitized = [];
    for (const message of messages ?? []) {
        if (!isRecord(message) || typeof message.role !== "string")
            continue;
        if ((message.role === "system" || message.role === "user") &&
            typeof message.content === "string" &&
            message.content.trim()) {
            sanitized.push({
                role: message.role,
                content: message.content,
            });
            continue;
        }
        if (message.role === "assistant") {
            if (hasToolCalls(message) &&
                Array.isArray(message.toolCalls) &&
                message.toolCalls.length > 0) {
                const toolCalls = message.toolCalls
                    .filter((toolCall) => isRecord(toolCall) &&
                    typeof toolCall.id === "string" &&
                    typeof toolCall.name === "string" &&
                    typeof toolCall.arguments === "string" &&
                    !!toolCall.name.trim())
                    .map((toolCall) => ({
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
        if (message.role === "tool" &&
            typeof message.toolCallId === "string" &&
            typeof message.name === "string" &&
            typeof message.content === "string") {
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
function sanitizeLLMTools(tools) {
    return (tools ?? []).flatMap((tool) => {
        if (!isRecord(tool) ||
            typeof tool.name !== "string" ||
            !tool.name.trim() ||
            typeof tool.description !== "string" ||
            !isRecord(tool.inputSchema)) {
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
function toolCallId(prefix) {
    return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}
function parseToolArguments(raw) {
    const normalized = raw.trim();
    if (!normalized)
        return {};
    try {
        const parsed = JSON.parse(normalized);
        return isRecord(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
function openAiContentToText(content) {
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return "";
    return content
        .map((part) => {
        if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") {
            return "";
        }
        return part.text;
    })
        .join("");
}
function toOpenAiMessages(systemPrompt, messages) {
    const input = [];
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
function toGoogleContents(messages) {
    const contents = [];
    for (const message of messages) {
        if (message.role === "system")
            continue;
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
function extractGoogleToolCalls(response) {
    const firstCandidate = Array.isArray(response.candidates) ? response.candidates[0] : null;
    const content = isRecord(firstCandidate) && isRecord(firstCandidate.content) ? firstCandidate.content : null;
    const parts = content && Array.isArray(content.parts) ? content.parts : [];
    return parts.flatMap((part) => {
        if (!isRecord(part) || !isRecord(part.functionCall))
            return [];
        const functionCall = part.functionCall;
        if (typeof functionCall.name !== "string" || !functionCall.name.trim()) {
            return [];
        }
        const args = isRecord(functionCall.args) ? functionCall.args : {};
        return [
            {
                id: typeof functionCall.id === "string" && functionCall.id.trim()
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
async function generateOpenAiTurn({ model, token, systemPrompt, messages, tools, }) {
    const client = new OpenAI({ apiKey: token });
    const response = await client.chat.completions.create({
        model,
        messages: toOpenAiMessages(systemPrompt, messages),
        ...(tools.length
            ? {
                tools: tools.map((tool) => ({
                    type: "function",
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.inputSchema,
                    },
                })),
                tool_choice: "auto",
            }
            : {}),
    });
    const assistant = response.choices[0]?.message;
    if (!assistant) {
        throw new Error("OpenAI did not return a message.");
    }
    const toolCalls = (assistant.tool_calls ?? []).flatMap((toolCall) => {
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
    const message = {
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
async function generateGoogleTurn({ model, token, systemPrompt, messages, tools, }) {
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
    const toolCalls = extractGoogleToolCalls(response);
    if (toolCalls.length > 0) {
        return {
            output: {
                type: "tool_calls",
                toolCalls,
            },
        };
    }
    const message = {
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
function createSseStream(streamWriter) {
    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    void (async () => {
        const send = async (event, payload) => {
            await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
        };
        try {
            await send("ready", {});
            await streamWriter(send);
            await send("done", {});
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "LLM request failed.";
            await send("error", { error: message });
        }
        finally {
            await writer.close();
        }
    })();
    return readable;
}
async function streamGoogleChat(model, token, messages, send) {
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
        if (!delta)
            continue;
        await send("delta", { delta });
    }
}
async function streamOpenAiChat(model, token, messages, send) {
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
        if (chunk.type !== "response.output_text.delta")
            continue;
        const delta = chunk.delta;
        if (!delta)
            continue;
        await send("delta", { delta });
    }
}
app.get("/api/health", (c) => c.json({ ok: true }));
app.post("/api/llm/turn", async (c) => {
    const body = (await c.req.json().catch(() => null));
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
        const response = body.provider === "google"
            ? await generateGoogleTurn({ model, token, systemPrompt, messages, tools })
            : await generateOpenAiTurn({ model, token, systemPrompt, messages, tools });
        return c.json(response);
    }
    catch (error) {
        return c.json({
            error: error instanceof Error ? error.message : "LLM request failed.",
        }, 500);
    }
});
app.post("/api/llm/chat", async (c) => {
    const body = (await c.req.json().catch(() => null));
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
        const response = await c.env.AI.run("@cf/deepgram/nova-3", {
            audio: {
                body: request.body,
                contentType,
            },
            detect_language: detectLanguage,
            ...(language ? { language } : {}),
            punctuate: true,
            smart_format: true,
        }, { returnRawResponse: false });
        const transcript = response?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
        return c.json({ transcript });
    }
    catch (error) {
        return c.json({
            error: error instanceof Error ? error.message : "Transcription failed.",
        }, 500);
    }
});
app.get("/api/transcribe/ws", (c) => {
    if (c.req.header("upgrade") !== "websocket") {
        return c.json({ error: "WebSocket upgrade required." }, 426);
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    let language;
    let detectLanguage = true;
    let contentType = "audio/webm";
    let chain = Promise.resolve();
    server.accept();
    const sendPayload = (payload) => {
        try {
            server.send(JSON.stringify(payload));
        }
        catch {
            // Ignore send errors during shutdown.
        }
    };
    const normalizeContentType = (raw) => {
        const trimmed = raw?.trim();
        if (!trimmed)
            return "audio/webm";
        const base = trimmed.split(";")[0];
        if (base === "audio/webm" || base === "audio/ogg" || base === "audio/mp4") {
            return base;
        }
        return trimmed;
    };
    const enqueueTranscription = (bytes) => {
        const safeContentType = normalizeContentType(contentType);
        const blob = new Blob([bytes], { type: safeContentType });
        chain = chain
            .then(async () => {
            const response = await c.env.AI.run("@cf/deepgram/nova-3", {
                audio: {
                    body: blob.stream(),
                    contentType: safeContentType,
                },
                detect_language: detectLanguage,
                ...(language ? { language } : {}),
                punctuate: true,
                smart_format: true,
            }, { returnRawResponse: false });
            const transcript = response?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
            if (transcript) {
                sendPayload({ transcript, isPartial: false });
            }
        })
            .catch((error) => {
            sendPayload({ error: error instanceof Error ? error.message : "Transcription failed." });
            try {
                server.close(1011, "Transcription failed");
            }
            catch {
                // ignore
            }
        });
    };
    server.addEventListener("message", (event) => {
        const data = event.data;
        if (typeof data === "string") {
            try {
                const parsed = JSON.parse(data);
                if (parsed.type === "config") {
                    const normalized = normalizeNova3Language(parsed.language ?? null);
                    if (normalized)
                        language = normalized;
                    if (typeof parsed.detectLanguage === "boolean") {
                        detectLanguage = parsed.detectLanguage;
                    }
                    if (typeof parsed.contentType === "string" && parsed.contentType.trim()) {
                        contentType = parsed.contentType.trim();
                    }
                    sendPayload({ ok: true });
                }
            }
            catch (error) {
                sendPayload({ error: error instanceof Error ? error.message : "Invalid message." });
            }
            return;
        }
        if (data instanceof ArrayBuffer) {
            const bytes = new Uint8Array(data);
            if (bytes.byteLength > 0)
                enqueueTranscription(bytes);
            return;
        }
        if (data instanceof Uint8Array) {
            if (data.byteLength > 0)
                enqueueTranscription(data);
            return;
        }
        if (data instanceof Blob) {
            void data
                .arrayBuffer()
                .then((buffer) => {
                const bytes = new Uint8Array(buffer);
                if (bytes.byteLength > 0)
                    enqueueTranscription(bytes);
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
        }
        catch {
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
    const indexResponse = await c.env.ASSETS.fetch(new Request(new URL("/index.html", url), { method: "GET" }));
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
