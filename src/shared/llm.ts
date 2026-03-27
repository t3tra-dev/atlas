export type LLMProvider = "google" | "openai";

export type LLMToolCall = {
  id: string;
  name: string;
  arguments: string;
  extraContent?: {
    google?: {
      thoughtSignature?: string;
    };
  };
};

export type LLMUserMessage = {
  role: "user";
  content: string;
};

export type LLMSystemMessage = {
  role: "system";
  content: string;
};

export type LLMAssistantTextMessage = {
  role: "assistant";
  content: string;
};

export type LLMAssistantToolCallMessage = {
  role: "assistant";
  content?: string;
  toolCalls: Array<LLMToolCall>;
};

export type LLMToolResultMessage = {
  role: "tool";
  toolCallId: string;
  name: string;
  content: string;
};

export type LLMMessage =
  | LLMSystemMessage
  | LLMUserMessage
  | LLMAssistantTextMessage
  | LLMAssistantToolCallMessage
  | LLMToolResultMessage;

export type LLMToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type LLMTurnRequest = {
  provider?: LLMProvider;
  model?: string;
  token?: string;
  systemPrompt?: string;
  messages?: Array<LLMMessage>;
  tools?: Array<LLMToolDefinition>;
};

export type LLMTurnResponse =
  | {
      output: {
        type: "message";
        message: LLMAssistantTextMessage;
      };
    }
  | {
      output: {
        type: "tool_calls";
        toolCalls: Array<LLMToolCall>;
      };
    };
