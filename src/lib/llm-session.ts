import type {
  LLMAssistantTextMessage,
  LLMMessage,
  LLMToolCall,
  LLMToolDefinition,
  LLMTurnRequest,
  LLMTurnResponse,
} from "@/shared/llm";

type ToolExecutor = (args: unknown) => Promise<string> | string;

export type LocalLLMTool = LLMToolDefinition & {
  execute: ToolExecutor;
};

function isToolCallOutput(
  output: LLMTurnResponse["output"],
): output is Extract<LLMTurnResponse["output"], { type: "tool_calls" }> {
  return output.type === "tool_calls";
}

function parseToolArguments(toolCall: LLMToolCall) {
  const raw = toolCall.arguments.trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Tool '${toolCall.name}' returned invalid JSON arguments.`);
  }
}

async function requestLLMTurn(body: LLMTurnRequest): Promise<LLMTurnResponse> {
  const response = await fetch("/api/llm/turn", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || "LLM request failed.");
  }

  return (await response.json()) as LLMTurnResponse;
}

export async function runLLMSession({
  provider,
  model,
  token,
  systemPrompt,
  messages,
  tools,
  maxTurns = 6,
  onMessage,
}: {
  provider: LLMTurnRequest["provider"];
  model: string;
  token: string;
  systemPrompt?: string;
  messages: Array<LLMMessage>;
  tools?: Array<LocalLLMTool>;
  maxTurns?: number;
  onMessage?: (message: LLMMessage) => void | Promise<void>;
}): Promise<{ assistantMessage: LLMAssistantTextMessage; transcript: Array<LLMMessage> }> {
  const availableTools = tools ?? [];
  const toolMap = new Map(availableTools.map((tool) => [tool.name, tool]));
  let transcript = [...messages];

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const response = await requestLLMTurn({
      provider,
      model,
      token,
      systemPrompt,
      messages: transcript,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      tools: availableTools.map(({ execute: _execute, ...tool }) => tool),
    });

    if (!isToolCallOutput(response.output)) {
      const assistantMessage = response.output.message;
      transcript = [...transcript, assistantMessage];
      await onMessage?.(assistantMessage);
      return { assistantMessage, transcript };
    }

    if (!response.output.toolCalls.length) {
      throw new Error("LLM requested an empty tool call set.");
    }

    const assistantToolCallMessage: Extract<
      LLMMessage,
      { role: "assistant"; toolCalls: Array<LLMToolCall> }
    > = {
      role: "assistant",
      content: "",
      toolCalls: response.output.toolCalls,
    };
    transcript = [...transcript, assistantToolCallMessage];
    await onMessage?.(assistantToolCallMessage);

    for (const toolCall of response.output.toolCalls) {
      const tool = toolMap.get(toolCall.name);
      let toolResult: Extract<LLMMessage, { role: "tool" }>;

      if (!tool) {
        toolResult = {
          role: "tool",
          toolCallId: toolCall.id,
          name: toolCall.name,
          content: JSON.stringify(
            {
              ok: false,
              error: `Unknown tool '${toolCall.name}'.`,
            },
            null,
            2,
          ),
        };
      } else {
        try {
          const output = await tool.execute(parseToolArguments(toolCall));
          toolResult = {
            role: "tool",
            toolCallId: toolCall.id,
            name: toolCall.name,
            content: output,
          };
        } catch (error) {
          toolResult = {
            role: "tool",
            toolCallId: toolCall.id,
            name: toolCall.name,
            content: JSON.stringify(
              {
                ok: false,
                error: error instanceof Error ? error.message : "Tool execution failed.",
              },
              null,
              2,
            ),
          };
        }
      }

      transcript = [...transcript, toolResult];
      await onMessage?.(toolResult);
    }
  }

  throw new Error("LLM exceeded the tool call limit.");
}
