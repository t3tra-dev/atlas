import * as React from "react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildDocumentSnapshot } from "@/lib/document-snapshot";
import {
  createEditableLLMConfig,
  hasCompleteLLMConfig,
  LLM_DEFAULT_MODELS,
  LLM_MODELS_BY_PROVIDER,
  loadSavedLLMConfig,
  saveLLMConfig,
  type LLMProvider,
} from "@/lib/llm-config";
import { runLLMSession, type LocalLLMTool } from "@/lib/llm-session";
import { cn } from "@/lib/utils";
import type { LLMMessage, LLMToolCall } from "@/shared/llm";
import {
  BotIcon,
  ChevronLeftIcon,
  ListIcon,
  MessageSquareIcon,
  PlusIcon,
  Settings2Icon,
  Trash2Icon,
  WrenchIcon,
} from "lucide-react";
import type { ChatSidePanelProps } from "./types";

type ElementReferenceKind = "node" | "edge";
type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: Array<MarkdownNode>;
};

type ChatUserMessage = {
  id: string;
  role: "user";
  content: string;
};

type ChatAssistantTextMessage = {
  id: string;
  role: "assistant";
  kind: "text";
  content: string;
};

type ChatAssistantToolCallMessage = {
  id: string;
  role: "assistant";
  kind: "tool_calls";
  toolCalls: Array<LLMToolCall>;
};

type ChatToolResultMessage = {
  id: string;
  role: "tool";
  toolCallId: string;
  name: string;
  content: string;
};

type ChatMessage =
  | ChatUserMessage
  | ChatAssistantTextMessage
  | ChatAssistantToolCallMessage
  | ChatToolResultMessage;

type ChatToolGroup = {
  id: string;
  kind: "tool_group";
  toolCalls: Array<LLMToolCall>;
  results: Array<ChatToolResultMessage>;
};

type ChatDisplayItem = ChatUserMessage | ChatAssistantTextMessage | ChatToolGroup;

function isChatToolGroup(item: ChatDisplayItem): item is ChatToolGroup {
  return "kind" in item && item.kind === "tool_group";
}

type ChatThread = {
  id: string;
  title: string;
  messages: Array<ChatMessage>;
  createdAt: number;
  updatedAt: number;
};

type ChatHistoryState = {
  version: 1;
  activeThreadId: string;
  threads: Array<ChatThread>;
};

type EditableLLMConfig = {
  provider: LLMProvider;
  model: string;
  token: string;
};

type ChatPanelView = "conversation" | "threads";

const CHAT_HISTORY_STORAGE_KEY = "atlas.chat.history";
const EMPTY_THREAD_TITLE = "新規スレッド";
const SAFE_MARKDOWN_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:", "atlas-ref:"]);
const ELEMENT_REFERENCE_PATTERN = /elm\[((?:node|edge)_[a-zA-Z0-9_-]+)\]/g;

const ATLAS_CHAT_SYSTEM_PROMPT = [
  "You are Atlas, an assistant embedded in a visual document editor.",
  "Help the user understand and work with the currently open Atlas document.",
  "When the user asks about the current document, canvas, nodes, edges, layout, positions, relationships, camera, zoom, or selection, call get_current_document_state before answering.",
  "Base statements about the current document only on tool results.",
  "The tool returns each node's coordinates, size, center point, payload, and incoming/outgoing relations, plus camera position and zoom.",
  "When mentioning a specific node, write its canonical reference exactly as elm[node_xxxxxxxx] using the real node id from tool output.",
  "When mentioning a specific edge, write its canonical reference exactly as elm[edge_xxxxxxxx] using the real edge id from tool output.",
  "Never invent ids or elm[...] references. If unsure, do not emit a reference token.",
  "Do not repeat the element's visible name, quoted label, or title immediately next to an elm[...] reference, because the UI already renders the element label for that reference.",
  "Prefer the bare elm[...] reference when pointing to a specific element unless extra wording is necessary for grammar or disambiguation.",
  "When describing structure, cite node ids, edge ids, directions, and relative positions clearly.",
  "Respond in the user's language.",
  "Keep answers concrete and concise.",
].join("\n");

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createThreadId() {
  return `thread-${createMessageId()}`;
}

function sanitizeToolCalls(value: unknown): Array<LLMToolCall> {
  if (!Array.isArray(value)) return [];

  return value.flatMap((toolCall) => {
    if (!toolCall || typeof toolCall !== "object") return [];

    const candidate = toolCall as Partial<LLMToolCall>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.name !== "string" ||
      typeof candidate.arguments !== "string" ||
      !candidate.name.trim()
    ) {
      return [];
    }

    const google =
      candidate.extraContent?.google &&
      typeof candidate.extraContent.google === "object" &&
      typeof candidate.extraContent.google.thoughtSignature === "string"
        ? {
            google: {
              thoughtSignature: candidate.extraContent.google.thoughtSignature,
            },
          }
        : undefined;

    return [
      {
        id: candidate.id,
        name: candidate.name,
        arguments: candidate.arguments,
        ...(google ? { extraContent: google } : {}),
      },
    ];
  });
}

function sanitizeMessages(value: unknown): Array<ChatMessage> {
  if (!Array.isArray(value)) return [];

  return value.flatMap<ChatMessage>((message) => {
    if (!message || typeof message !== "object") return [];

    const candidate = message as {
      id?: unknown;
      role?: unknown;
      content?: unknown;
      kind?: unknown;
      toolCalls?: unknown;
      toolCallId?: unknown;
      name?: unknown;
    };
    if (typeof candidate.id !== "string") return [];

    if (candidate.role === "user" && typeof candidate.content === "string") {
      return [
        {
          id: candidate.id,
          role: "user",
          content: candidate.content,
        } satisfies ChatUserMessage,
      ];
    }

    if (
      candidate.role === "assistant" &&
      (candidate.kind === "text" || typeof candidate.kind === "undefined") &&
      typeof candidate.content === "string"
    ) {
      return [
        {
          id: candidate.id,
          role: "assistant",
          kind: "text",
          content: candidate.content,
        } satisfies ChatAssistantTextMessage,
      ];
    }

    if (candidate.role === "assistant" && candidate.kind === "tool_calls") {
      const toolCalls = sanitizeToolCalls(candidate.toolCalls);
      if (!toolCalls.length) return [];
      return [
        {
          id: candidate.id,
          role: "assistant",
          kind: "tool_calls",
          toolCalls,
        } satisfies ChatAssistantToolCallMessage,
      ];
    }

    if (
      candidate.role === "tool" &&
      typeof candidate.toolCallId === "string" &&
      typeof candidate.name === "string" &&
      typeof candidate.content === "string"
    ) {
      return [
        {
          id: candidate.id,
          role: "tool",
          toolCallId: candidate.toolCallId,
          name: candidate.name,
          content: candidate.content,
        } satisfies ChatToolResultMessage,
      ];
    }

    return [];
  });
}

function getMessagePreviewText(message: ChatMessage) {
  if (message.role === "user") return message.content;
  if (message.role === "assistant" && message.kind === "text") return message.content;
  if (message.role === "assistant") {
    return message.toolCalls.map((toolCall) => toolCall.name).join(", ");
  }
  return `${message.name} result`;
}

function chatMessageToLLMMessage(message: ChatMessage): LLMMessage {
  if (message.role === "user") {
    return {
      role: "user",
      content: message.content,
    };
  }

  if (message.role === "assistant" && message.kind === "text") {
    return {
      role: "assistant",
      content: message.content,
    };
  }

  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: "",
      toolCalls: message.toolCalls,
    };
  }

  return {
    role: "tool",
    toolCallId: message.toolCallId,
    name: message.name,
    content: message.content,
  };
}

function llmMessageToChatMessages(message: LLMMessage): Array<ChatMessage> {
  if (message.role === "system") return [];

  if (message.role === "user") {
    return [
      {
        id: createMessageId(),
        role: "user",
        content: message.content,
      },
    ];
  }

  if (message.role === "tool") {
    return [
      {
        id: createMessageId(),
        role: "tool",
        toolCallId: message.toolCallId,
        name: message.name,
        content: message.content,
      },
    ];
  }

  if ("toolCalls" in message) {
    return [
      {
        id: createMessageId(),
        role: "assistant",
        kind: "tool_calls",
        toolCalls: message.toolCalls,
      },
    ];
  }

  return [
    {
      id: createMessageId(),
      role: "assistant",
      kind: "text",
      content: message.content,
    },
  ];
}

function summarizeThread(messages: Array<ChatMessage>) {
  const firstUserMessage = messages.find(
    (message): message is ChatUserMessage =>
      message.role === "user" && message.content.trim().length > 0,
  );
  if (!firstUserMessage) return EMPTY_THREAD_TITLE;

  const normalized = firstUserMessage.content.replace(/\s+/g, " ").trim();
  return normalized.length > 36 ? `${normalized.slice(0, 36)}...` : normalized;
}

function createEmptyThread(title = EMPTY_THREAD_TITLE): ChatThread {
  const now = Date.now();
  return {
    id: createThreadId(),
    title,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function sanitizeMarkdownUrl(url: string) {
  if (!url) return "";
  if (url.startsWith("#") || url.startsWith("/")) return url;
  if (url.startsWith("//")) return "";

  try {
    const parsed = new URL(url, "https://atlas.local");
    const hasExplicitProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(url);
    if (!hasExplicitProtocol) {
      return url;
    }

    return SAFE_MARKDOWN_PROTOCOLS.has(parsed.protocol) ? url : "";
  } catch {
    return "";
  }
}

function getElementReferenceKind(elementId: string): ElementReferenceKind | null {
  if (elementId.startsWith("node_")) return "node";
  if (elementId.startsWith("edge_")) return "edge";
  return null;
}

function parseElementReferenceHref(href: string | undefined) {
  if (!href?.startsWith("atlas-ref:")) return null;
  const elementId = href.slice("atlas-ref:".length);
  const kind = getElementReferenceKind(elementId);
  if (!kind) return null;
  return { kind, elementId };
}

function normalizeReferenceLabel(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 30 ? `${normalized.slice(0, 30)}...` : normalized;
}

function getNodeReferenceLabel(node: ChatSidePanelProps["doc"]["nodes"][string]) {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const candidates = [props.name, props.title, props.label, props.text, props.fileName];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return normalizeReferenceLabel(candidate);
    }
  }

  return node.id;
}

function getEdgeReferenceLabel(doc: ChatSidePanelProps["doc"], edgeId: string) {
  const edge = doc.edges[edgeId];
  if (!edge) return edgeId;
  if (typeof edge.props.label === "string" && edge.props.label.trim()) {
    return normalizeReferenceLabel(edge.props.label);
  }

  const fromNode = doc.nodes[edge.from];
  const toNode = doc.nodes[edge.to];
  if (fromNode && toNode) {
    return `${getNodeReferenceLabel(fromNode)} -> ${getNodeReferenceLabel(toNode)}`;
  }

  return edge.id;
}

function getElementReferenceLabel(doc: ChatSidePanelProps["doc"], elementId: string) {
  const kind = getElementReferenceKind(elementId);
  if (kind === "node") {
    const node = doc.nodes[elementId];
    return node ? getNodeReferenceLabel(node) : elementId;
  }
  if (kind === "edge") {
    return getEdgeReferenceLabel(doc, elementId);
  }
  return elementId;
}

function replaceElementReferencesInText(value: string, doc: ChatSidePanelProps["doc"]) {
  const matches = Array.from(value.matchAll(ELEMENT_REFERENCE_PATTERN));
  if (!matches.length) {
    return [{ type: "text", value }] satisfies Array<MarkdownNode>;
  }

  const nodes: Array<MarkdownNode> = [];
  let cursor = 0;

  for (const match of matches) {
    const matchedValue = match[0];
    const elementId = match[1];
    const index = match.index ?? 0;

    if (index > cursor) {
      nodes.push({ type: "text", value: value.slice(cursor, index) });
    }

    nodes.push({
      type: "link",
      url: `atlas-ref:${elementId}`,
      children: [{ type: "text", value: getElementReferenceLabel(doc, elementId) }],
    });

    cursor = index + matchedValue.length;
  }

  if (cursor < value.length) {
    nodes.push({ type: "text", value: value.slice(cursor) });
  }

  return nodes;
}

function createElementReferencePlugin(doc: ChatSidePanelProps["doc"]) {
  return () => {
    return (tree: MarkdownNode) => {
      const visit = (node: MarkdownNode) => {
        if (!node.children?.length) return;

        node.children = node.children.flatMap((child) => {
          if (child.type === "text" && typeof child.value === "string") {
            return replaceElementReferencesInText(child.value, doc);
          }

          if (
            child.type !== "inlineCode" &&
            child.type !== "code" &&
            child.type !== "html" &&
            child.type !== "link"
          ) {
            visit(child);
          }

          return [child];
        });
      };

      visit(tree);
    };
  };
}

function AssistantMessageContent({
  content,
  doc,
  onElementReferenceActivate,
}: {
  content: string;
  doc: ChatSidePanelProps["doc"];
  onElementReferenceActivate?: (elementId: string) => void;
}) {
  const referencePlugin = React.useMemo(() => createElementReferencePlugin(doc), [doc]);

  return (
    <div className="space-y-3 break-words text-sm leading-6">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, referencePlugin]}
        skipHtml
        disallowedElements={["img"]}
        urlTransform={(url) => sanitizeMarkdownUrl(url)}
        components={{
          p: ({ children }) => <p>{children}</p>,
          a: ({ children, href }) => {
            const reference = parseElementReferenceHref(href);
            if (reference) {
              return (
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onElementReferenceActivate?.(reference.elementId);
                  }}
                  className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 align-baseline text-xs font-medium text-foreground transition-colors hover:bg-accent"
                >
                  <BotIcon className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{children}</span>
                </button>
              );
            }

            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className="font-medium text-primary underline underline-offset-4"
              >
                {children}
              </a>
            );
          },
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border/80 pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          h1: ({ children }) => <h1 className="text-base font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold">{children}</h3>,
          hr: () => <hr className="border-border" />,
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs leading-5">
              {children}
            </pre>
          ),
          code: ({ children, className }) => {
            const isBlock = Boolean(className);
            return (
              <code
                className={cn(
                  isBlock
                    ? "font-mono"
                    : "rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8125rem]",
                  className,
                )}
              >
                {children}
              </code>
            );
          },
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="border-b border-border">{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => (
            <tr className="border-b border-border/70 last:border-b-0">{children}</tr>
          ),
          th: ({ children }) => <th className="px-2 py-1.5 font-medium">{children}</th>,
          td: ({ children }) => <td className="px-2 py-1.5 align-top">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function AssistantLoadingBubble() {
  return (
    <div className="rounded-md border bg-background px-3 py-3 text-sm">
      <div className="flex items-center gap-3 text-muted-foreground">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="size-2 rounded-full bg-current animate-bounce"
              style={{ animationDelay: `${index * 0.15}s` }}
            />
          ))}
        </div>
        <span className="text-xs">AI が応答を生成しています...</span>
      </div>
    </div>
  );
}

function normalizeThread(raw: unknown, index: number): ChatThread | null {
  if (!raw || typeof raw !== "object") return null;

  const rawThread = raw as Partial<ChatThread>;
  const messages = sanitizeMessages(rawThread.messages);
  const fallbackTitle = summarizeThread(messages);
  const title =
    typeof rawThread.title === "string" && rawThread.title.trim()
      ? rawThread.title.trim()
      : fallbackTitle;
  const createdAt =
    typeof rawThread.createdAt === "number" ? rawThread.createdAt : Date.now() - index;
  const updatedAt = typeof rawThread.updatedAt === "number" ? rawThread.updatedAt : createdAt;

  return {
    id: typeof rawThread.id === "string" && rawThread.id.trim() ? rawThread.id : createThreadId(),
    title,
    messages,
    createdAt,
    updatedAt,
  };
}

function normalizeChatHistory(value: unknown): ChatHistoryState {
  if (Array.isArray(value)) {
    const messages = sanitizeMessages(value);
    const migrated = createEmptyThread(summarizeThread(messages));
    migrated.messages = messages;
    migrated.updatedAt = Date.now();
    return {
      version: 1,
      activeThreadId: migrated.id,
      threads: [migrated],
    };
  }

  if (!value || typeof value !== "object") {
    const initialThread = createEmptyThread();
    return {
      version: 1,
      activeThreadId: initialThread.id,
      threads: [initialThread],
    };
  }

  const rawState = value as Partial<ChatHistoryState>;
  const threads = Array.isArray(rawState.threads)
    ? rawState.threads
        .map((thread, index) => normalizeThread(thread, index))
        .filter((thread): thread is ChatThread => thread != null)
        .sort((left, right) => right.updatedAt - left.updatedAt)
    : [];

  if (!threads.length) {
    const initialThread = createEmptyThread();
    return {
      version: 1,
      activeThreadId: initialThread.id,
      threads: [initialThread],
    };
  }

  const activeThreadId =
    typeof rawState.activeThreadId === "string" &&
    threads.some((thread) => thread.id === rawState.activeThreadId)
      ? rawState.activeThreadId
      : threads[0].id;

  return {
    version: 1,
    activeThreadId,
    threads,
  };
}

function loadStoredChatHistory() {
  if (typeof window === "undefined") {
    return normalizeChatHistory(null);
  }

  try {
    const raw = window.localStorage.getItem(CHAT_HISTORY_STORAGE_KEY);
    if (!raw) return normalizeChatHistory(null);
    return normalizeChatHistory(JSON.parse(raw) as unknown);
  } catch {
    window.localStorage.removeItem(CHAT_HISTORY_STORAGE_KEY);
    return normalizeChatHistory(null);
  }
}

function upsertThread(
  state: ChatHistoryState,
  thread: ChatThread,
  activeThreadId = thread.id,
): ChatHistoryState {
  const remaining = state.threads.filter((entry) => entry.id !== thread.id);
  return {
    version: 1,
    activeThreadId,
    threads: [thread, ...remaining].sort((left, right) => right.updatedAt - left.updatedAt),
  };
}

function formatThreadPreview(thread: ChatThread) {
  const lastMessage = [...thread.messages]
    .reverse()
    .find((message) => getMessagePreviewText(message).trim());
  if (!lastMessage) return "まだメッセージはありません";

  const normalized = getMessagePreviewText(lastMessage).replace(/\s+/g, " ").trim();
  return normalized.length > 48 ? `${normalized.slice(0, 48)}...` : normalized;
}

function formatStructuredContent(content: string) {
  const normalized = content.trim();
  if (!normalized) return "{}";

  try {
    return JSON.stringify(JSON.parse(normalized) as unknown, null, 2);
  } catch {
    return content;
  }
}

function groupMessagesForDisplay(messages: Array<ChatMessage>): Array<ChatDisplayItem> {
  const items: Array<ChatDisplayItem> = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];

    if (message.role === "assistant" && message.kind === "tool_calls") {
      const results: Array<ChatToolResultMessage> = [];
      let cursor = index + 1;

      while (cursor < messages.length) {
        const nextMessage = messages[cursor];
        if (nextMessage.role !== "tool") break;
        results.push(nextMessage);
        cursor += 1;
      }

      items.push({
        id: message.id,
        kind: "tool_group",
        toolCalls: message.toolCalls,
        results,
      });
      index = cursor - 1;
      continue;
    }

    if (message.role === "tool") {
      continue;
    }

    items.push(message);
  }

  return items;
}

function ToolCallsMessageContent({ toolCalls }: { toolCalls: Array<LLMToolCall> }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <WrenchIcon className="size-3.5" />
        <span>Tool Calls</span>
      </div>
      <div className="space-y-2">
        {toolCalls.map((toolCall, index) => (
          <details
            key={toolCall.id}
            className="rounded-md border border-border bg-background open:bg-muted/30"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm marker:hidden">
              <div className="min-w-0">
                <div className="truncate font-medium">{toolCall.name}</div>
                <div className="text-xs text-muted-foreground">call #{index + 1}</div>
              </div>
              <span className="text-xs text-muted-foreground">arguments</span>
            </summary>
            <div className="border-t border-border px-3 py-2">
              <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs leading-5 text-foreground">
                {formatStructuredContent(toolCall.arguments)}
              </pre>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function ToolGroupMessageContent({ group }: { group: ChatToolGroup }) {
  return (
    <div className="space-y-3 text-sm">
      <ToolCallsMessageContent toolCalls={group.toolCalls} />
      {group.results.length ? (
        <div className="space-y-2 border-t border-border/70 pt-3">
          {group.results.map((message) => (
            <ToolResultMessageContent key={message.id} message={message} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ToolResultMessageContent({ message }: { message: ChatToolResultMessage }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <WrenchIcon className="size-3.5" />
        <span>Tool Result</span>
      </div>
      <details className="rounded-md border border-border bg-background open:bg-muted/30">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm marker:hidden">
          <div className="min-w-0">
            <div className="truncate font-medium">{message.name}</div>
            <div className="truncate text-xs text-muted-foreground">{message.toolCallId}</div>
          </div>
          <span className="text-xs text-muted-foreground">output</span>
        </summary>
        <div className="border-t border-border px-3 py-2">
          <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs leading-5 text-foreground whitespace-pre-wrap break-words">
            {formatStructuredContent(message.content)}
          </pre>
        </div>
      </details>
    </div>
  );
}

function ChatSettingsForm({
  config,
  disabled,
  onChange,
  onSave,
}: {
  config: EditableLLMConfig;
  disabled?: boolean;
  onChange: (next: EditableLLMConfig) => void;
  onSave: () => void;
}) {
  const modelOptions = LLM_MODELS_BY_PROVIDER[config.provider];
  const saveDisabled = disabled || !config.model.trim() || !config.token.trim();

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="atlas-llm-provider">Provider</Label>
        <select
          id="atlas-llm-provider"
          className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none"
          value={config.provider}
          onChange={(event) => {
            const provider = event.target.value as LLMProvider;
            onChange({
              provider,
              model: LLM_DEFAULT_MODELS[provider],
              token: config.token,
            });
          }}
          disabled={disabled}
        >
          <option value="google">Google</option>
          <option value="openai">OpenAI</option>
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="atlas-llm-model">Model</Label>
        <select
          id="atlas-llm-model"
          className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none"
          value={config.model}
          onChange={(event) => onChange({ ...config, model: event.target.value })}
          disabled={disabled}
        >
          {modelOptions.map((modelName) => (
            <option key={modelName} value={modelName}>
              {modelName}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="atlas-llm-token">Token</Label>
        <Input
          id="atlas-llm-token"
          type="password"
          value={config.token}
          onChange={(event) => onChange({ ...config, token: event.target.value })}
          placeholder="Paste your API token"
          disabled={disabled}
        />
      </div>

      <Button className="w-full" onClick={onSave} disabled={saveDisabled}>
        設定を保存
      </Button>
    </div>
  );
}

export function ChatSidePanel({
  doc,
  activeDocId,
  selectedNode,
  selectedEdge,
  isActive,
  onElementReferenceActivate,
}: ChatSidePanelProps) {
  const conversationRef = React.useRef<HTMLDivElement | null>(null);
  const wasActiveRef = React.useRef(isActive);
  const [savedConfig, setSavedConfig] = React.useState(() => loadSavedLLMConfig());
  const [draftConfig, setDraftConfig] = React.useState<EditableLLMConfig>(() =>
    createEditableLLMConfig(loadSavedLLMConfig()),
  );
  const [chatHistory, setChatHistory] = React.useState<ChatHistoryState>(() =>
    loadStoredChatHistory(),
  );
  const [panelView, setPanelView] = React.useState<ChatPanelView>("threads");
  const [draft, setDraft] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [threadPendingDelete, setThreadPendingDelete] = React.useState<ChatThread | null>(null);
  const activeThread = React.useMemo(
    () =>
      chatHistory.threads.find((thread) => thread.id === chatHistory.activeThreadId) ??
      chatHistory.threads[0],
    [chatHistory],
  );
  const messages = React.useMemo(() => activeThread?.messages ?? [], [activeThread]);
  const displayItems = React.useMemo(() => groupMessagesForDisplay(messages), [messages]);
  const llmTools = React.useMemo<Array<LocalLLMTool>>(
    () => [
      {
        name: "get_current_document_state",
        description:
          "Returns the current Atlas document state including title, selection, camera position and zoom, canvas settings, every node's coordinates and payload, and node-to-node relationships.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        execute: async () =>
          JSON.stringify(
            buildDocumentSnapshot({
              doc,
              activeDocId,
              selectedNodeId: selectedNode?.id ?? null,
              selectedEdgeId: selectedEdge?.id ?? null,
            }),
            null,
            2,
          ),
      },
    ],
    [activeDocId, doc, selectedEdge?.id, selectedNode?.id],
  );

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(chatHistory));
  }, [chatHistory]);

  React.useEffect(() => {
    const viewport = conversationRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [displayItems, isSubmitting]);

  React.useEffect(() => {
    if (isActive && !wasActiveRef.current) {
      setPanelView("threads");
      setError(null);
    }
    wasActiveRef.current = isActive;
  }, [isActive]);

  const hasConfig = hasCompleteLLMConfig(savedConfig);

  const applyDraftConfig = React.useCallback(() => {
    const next = {
      provider: draftConfig.provider,
      model: draftConfig.model.trim(),
      token: draftConfig.token.trim(),
    };

    saveLLMConfig(next);
    setSavedConfig(next);
    setDraftConfig(next);
    setError(null);
    setIsSettingsOpen(false);
  }, [draftConfig]);

  const openNewThread = React.useCallback(() => {
    if (isSubmitting) return;

    const nextThread = createEmptyThread();
    setChatHistory((current) => ({
      version: 1,
      activeThreadId: nextThread.id,
      threads: [nextThread, ...current.threads],
    }));
    setPanelView("conversation");
    setDraft("");
    setError(null);
  }, [isSubmitting]);

  const selectThread = React.useCallback(
    (threadId: string) => {
      if (isSubmitting) return;
      setChatHistory((current) =>
        current.threads.some((thread) => thread.id === threadId)
          ? { ...current, activeThreadId: threadId }
          : current,
      );
      setPanelView("conversation");
      setError(null);
    },
    [isSubmitting],
  );

  const requestDeleteThread = React.useCallback(
    (threadId: string) => {
      if (isSubmitting) return;

      const thread = chatHistory.threads.find((entry) => entry.id === threadId) ?? null;
      setThreadPendingDelete(thread);
    },
    [chatHistory.threads, isSubmitting],
  );

  const confirmDeleteThread = React.useCallback(
    (threadId: string) => {
      if (isSubmitting) return;

      setChatHistory((current) => {
        const remaining = current.threads.filter((thread) => thread.id !== threadId);
        if (!remaining.length) {
          const fallbackThread = createEmptyThread();
          return {
            version: 1,
            activeThreadId: fallbackThread.id,
            threads: [fallbackThread],
          };
        }

        return {
          version: 1,
          activeThreadId:
            current.activeThreadId === threadId ? remaining[0].id : current.activeThreadId,
          threads: remaining.sort((left, right) => right.updatedAt - left.updatedAt),
        };
      });
      setPanelView("threads");
      setError(null);
      setThreadPendingDelete(null);
    },
    [isSubmitting],
  );

  const sendMessage = React.useCallback(async () => {
    if (!hasCompleteLLMConfig(savedConfig)) {
      setError("設定を保存してください。");
      return;
    }

    const content = draft.trim();
    if (!content || isSubmitting) return;

    const threadId = activeThread?.id ?? createThreadId();
    const now = Date.now();
    const currentMessages = activeThread?.messages ?? [];
    const currentTitle = activeThread?.title ?? EMPTY_THREAD_TITLE;

    const userMessage: ChatUserMessage = {
      id: createMessageId(),
      role: "user",
      content,
    };
    const nextMessages = [...currentMessages, userMessage];

    setChatHistory((current) =>
      upsertThread(
        current,
        {
          id: threadId,
          title: currentTitle === EMPTY_THREAD_TITLE ? summarizeThread(nextMessages) : currentTitle,
          messages: nextMessages,
          createdAt: activeThread?.createdAt ?? now,
          updatedAt: now,
        },
        threadId,
      ),
    );
    setDraft("");
    setError(null);
    setIsSubmitting(true);

    try {
      const llmMessages: Array<LLMMessage> = nextMessages.map(chatMessageToLLMMessage);

      const result = await runLLMSession({
        provider: savedConfig.provider,
        model: savedConfig.model,
        token: savedConfig.token,
        systemPrompt: ATLAS_CHAT_SYSTEM_PROMPT,
        messages: llmMessages,
        tools: llmTools,
      });

      const assistantContent = result.assistantMessage.content.trim();
      if (!assistantContent) {
        throw new Error("LLM returned an empty response.");
      }

      const appendedMessages = result.transcript
        .slice(llmMessages.length)
        .flatMap(llmMessageToChatMessages);

      setChatHistory((current) =>
        upsertThread(
          current,
          {
            ...(current.threads.find((thread) => thread.id === threadId) ?? createEmptyThread()),
            id: threadId,
            title:
              currentTitle === EMPTY_THREAD_TITLE ? summarizeThread(nextMessages) : currentTitle,
            createdAt: activeThread?.createdAt ?? now,
            updatedAt: Date.now(),
            messages: [
              ...(current.threads.find((thread) => thread.id === threadId)?.messages ?? []),
              ...appendedMessages,
            ],
          },
          current.activeThreadId,
        ),
      );
    } catch (caughtError) {
      setChatHistory((current) =>
        upsertThread(
          current,
          {
            ...(current.threads.find((thread) => thread.id === threadId) ?? createEmptyThread()),
            id: threadId,
            updatedAt: Date.now(),
            messages: current.threads.find((thread) => thread.id === threadId)?.messages ?? [],
          },
          current.activeThreadId,
        ),
      );
      setError(caughtError instanceof Error ? caughtError.message : "LLM request failed.");
    } finally {
      setIsSubmitting(false);
    }
  }, [activeThread, draft, isSubmitting, llmTools, savedConfig]);

  const onDraftKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      void sendMessage();
    },
    [sendMessage],
  );

  if (!hasConfig) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <MessageSquareIcon className="size-4" />
          <span>LLM Integration</span>
        </div>

        <div className="mt-3 text-xs text-muted-foreground">
          Provider、Model、Token を設定する必要があります。
        </div>

        <div className="mt-4 flex-1 rounded-lg border bg-muted/20 p-4">
          <div className="text-sm font-medium">LLM 設定</div>
          <div className="mt-1 text-xs text-muted-foreground">各設定は Cookie に保存されます。</div>

          <div className="mt-4">
            <ChatSettingsForm
              config={draftConfig}
              onChange={setDraftConfig}
              onSave={applyDraftConfig}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 text-sm font-semibold">
        <div className="flex min-w-0 items-center gap-2">
          {panelView === "threads" ? (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="会話に戻る"
              onClick={() => setPanelView("conversation")}
            >
              <ChevronLeftIcon className="size-3.5" />
            </Button>
          ) : null}
          <span className="truncate">
            {panelView === "threads" ? "Threads" : (activeThread?.title ?? "LLM Integration")}
          </span>
        </div>

        {panelView === "conversation" ? (
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="スレッド一覧"
            onClick={() => setPanelView("threads")}
            disabled={isSubmitting}
            className="shrink-0"
          >
            <ListIcon className="size-4" />
          </Button>
        ) : null}
      </div>

      <div className="mt-4 flex-1 min-h-0 overflow-hidden">
        {panelView === "threads" ? (
          <div className="flex h-full min-h-0 flex-col rounded-lg border bg-muted/20 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-muted-foreground">保存済みスレッド</div>
              <Button
                size="xs"
                variant="outline"
                onClick={openNewThread}
                disabled={!hasConfig || isSubmitting}
              >
                <PlusIcon className="size-3.5" />
                新規
              </Button>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto">
              {chatHistory.threads.map((thread) => {
                const isActive = thread.id === activeThread?.id;

                return (
                  <div
                    key={thread.id}
                    className={cn(
                      "flex items-start gap-2 rounded-lg border bg-background px-3 py-2.5",
                      isActive ? "border-primary/50 bg-primary/5" : "border-border",
                    )}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 overflow-hidden text-left"
                      onClick={() => selectThread(thread.id)}
                      disabled={isSubmitting}
                    >
                      <div className="truncate pr-1 text-sm font-medium leading-5">
                        {thread.title}
                      </div>
                      <div className="mt-0.5 truncate pr-1 text-xs leading-4 text-muted-foreground">
                        {formatThreadPreview(thread)}
                      </div>
                    </button>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      className="mt-0.5 shrink-0 self-start"
                      aria-label="スレッドを削除"
                      onClick={() => requestDeleteThread(thread.id)}
                      disabled={isSubmitting}
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 border-t pt-3">
              <Button
                className="w-full"
                variant="outline"
                onClick={() => setIsSettingsOpen(true)}
                disabled={isSubmitting}
              >
                <Settings2Icon className="size-4" />
                設定を開く
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col rounded-lg border bg-muted/20 p-3">
            <div ref={conversationRef} className="flex-1 space-y-2 overflow-y-auto">
              {displayItems.length ? (
                <>
                  {displayItems.map((item) => (
                    <div
                      key={item.id}
                      className={
                        isChatToolGroup(item)
                          ? "rounded-md border border-dashed bg-background px-3 py-2"
                          : item.role === "assistant"
                          ? "rounded-md border bg-background px-3 py-2"
                          : "rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground whitespace-pre-wrap break-words"
                      }
                    >
                      {isChatToolGroup(item) ? (
                        <ToolGroupMessageContent group={item} />
                      ) : item.role === "assistant" ? (
                        <AssistantMessageContent
                          content={item.content}
                          doc={doc}
                          onElementReferenceActivate={onElementReferenceActivate}
                        />
                      ) : (
                        item.content
                      )}
                    </div>
                  ))}
                  {isSubmitting ? <AssistantLoadingBubble /> : null}
                </>
              ) : (
                <>
                  <div className="rounded-md bg-background px-3 py-2 text-sm">
                    {activeThread?.title ?? EMPTY_THREAD_TITLE}
                  </div>
                  <div className="rounded-md border border-dashed bg-background px-3 py-3 text-sm text-muted-foreground">
                    このスレッドに最初のメッセージを送ると、会話履歴が保存されます。
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {panelView === "conversation" ? (
        <div className="mt-4 space-y-2 border-t pt-4">
          <Label htmlFor="atlas-chat-draft">メッセージ</Label>
          <textarea
            id="atlas-chat-draft"
            className="min-h-28 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onDraftKeyDown}
            placeholder="Ask Atlas AI about this canvas..."
            disabled={!hasConfig || isSubmitting}
          />
          <div className="text-xs text-muted-foreground">Enter で送信、Shift+Enter で改行</div>
          {error ? <div className="text-xs text-destructive">{error}</div> : null}
        </div>
      ) : null}

      <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>LLM 設定</DialogTitle>
            <DialogDescription>Provider、Model、Token は Cookie に保存されます。</DialogDescription>
          </DialogHeader>

          <ChatSettingsForm
            config={draftConfig}
            onChange={setDraftConfig}
            onSave={applyDraftConfig}
            disabled={isSubmitting}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={threadPendingDelete != null}
        onOpenChange={(open) => {
          if (!open) {
            setThreadPendingDelete(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>スレッドを削除</DialogTitle>
            <DialogDescription>
              {threadPendingDelete
                ? `「${threadPendingDelete.title}」を削除します。この操作は元に戻せません。`
                : "この操作は元に戻せません。"}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" onClick={() => setThreadPendingDelete(null)}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (threadPendingDelete) {
                  confirmDeleteThread(threadPendingDelete.id);
                }
              }}
            >
              削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
