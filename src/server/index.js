import { GoogleGenAI } from "@google/genai";
import { Hono } from "hono";
import OpenAI from "openai";
const app = new Hono();
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
            if (hasToolCalls(message) && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
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
    const toolCalls = (response.functionCalls ?? [])
        .filter((toolCall) => typeof toolCall.name === "string" && !!toolCall.name.trim())
        .map((toolCall) => ({
        id: toolCall.id ?? toolCallId("google_call"),
        name: toolCall.name ?? "unknown",
        arguments: JSON.stringify(toolCall.args ?? {}),
    }));
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
