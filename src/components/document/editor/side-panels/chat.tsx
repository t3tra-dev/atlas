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
import { buildMermaidElements } from "@/plugins/builtin/mermaid";
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
  cancelNodeAnimation,
  collectNodeStartPositions,
  createDerivedNodesFromSource,
  createPositionedShapeNodes,
  deleteNodesById,
  editEdgesById,
  editNodesById,
  mergeMermaidBuildResultIntoDocument,
  runNodeAnimation,
  type EdgeArrowEdit,
  type EdgeEditChanges,
  type DerivedShapeNodeInput,
  type NodeEditChanges,
  type PositionedShapeNodeInput,
  type SupportedShape,
} from "@/components/document/editor/document-editing";
import { centerMermaidBuildResultOnPoint } from "@/components/document/editor/shared";
import type { MermaidDirection } from "@/plugins/builtin/mermaid/types";
import type { EdgeShape } from "@/components/document/model";
import { subscribeVoiceInputToggle } from "@/plugins/builtin/gestures/voice-input-toggle-bus";
import {
  BotIcon,
  ChevronLeftIcon,
  ListIcon,
  MessageSquareIcon,
  MicIcon,
  PlusIcon,
  Settings2Icon,
  SquareIcon,
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

const CHAT_HISTORY_STORAGE_KEY_PREFIX = "atlas.chat.history";
const EMPTY_THREAD_TITLE = "新規スレッド";
const SAFE_MARKDOWN_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:", "atlas-ref:"]);
const ELEMENT_REFERENCE_PATTERN = /elm\[((?:node|edge)_[a-zA-Z0-9_-]+)\]/g;
const DOCUMENT_SHAPES = [
  "rect",
  "stadium",
  "subroutine",
  "cylinder",
  "circle",
  "doublecircle",
  "diamond",
  "hexagon",
  "parallelogram",
  "trapezoid",
  "invtrapezoid",
] as const satisfies ReadonlyArray<SupportedShape>;
const MERMAID_DIRECTIONS = [
  "TB",
  "TD",
  "LR",
  "RL",
  "BT",
] as const satisfies ReadonlyArray<MermaidDirection>;
const EDGE_SHAPES = ["line", "curve"] as const satisfies ReadonlyArray<EdgeShape>;
const EDGE_ARROW_EDITS = [
  "none",
  "forward",
  "reverse",
  "both",
] as const satisfies ReadonlyArray<EdgeArrowEdit>;
const AUDIO_INPUT_PREFIX = "[audio input] ";
const CJK_CHAR_PATTERN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

const ATLAS_CHAT_SYSTEM_PROMPT = [
  "You are an AI assistant named atlas, integrated into a visual document editor.",
  "Help the user understand and work with the currently open atlas document.",
  "If the user asks about the current document, canvas, nodes, edges, layout, positions, relationships, camera, zoom, or selection, call get_current_document_state before answering.",
  "If the user asks to edit the current document by creating, deriving, or deleting nodes, use the document editing tools instead of just explaining the changes.",
  "If the user provides Mermaid text and a target center point, or asks to generate a whole graph from Mermaid text, call create_mermaid_graph_at_center.",
  "If the user asks to edit existing nodes or existing edges, use the dedicated edit tools and only include the fields that should actually change.",
  "When creating nodes directly, use create_document_nodes and specify the world coordinates, shape, and text for each node.",
  "When expanding derived nodes from existing node IDs, use derive_document_nodes_from_node so the atlas layout engine can interpret them.",
  "When deleting, use delete_document_nodes with one or more node IDs.",
  "When editing existing nodes, use edit_document_nodes with nodeIds and a changes object.",
  "When editing existing edges, use edit_document_edges with edgeIds and a changes object.",
  "Base any descriptions of the current document solely on the tool results.",
  "When mentioning specific nodes, prefer the actual node IDs from the tool output and refer to them exactly as elm[node_xxxxxxxx].",
  "When mentioning specific edges, prefer the actual edge IDs from the tool output and refer to them exactly as elm[edge_xxxxxxxx].",
  "Never fabricate IDs or elm[...] references. If you are unsure, do not output a reference token.",
  "Do not repeat the element's visible name, quoted label, or title immediately after an elm[...] reference. The UI already displays a label for that reference.",
  "When pointing to a specific element, default to the bare elm[...] reference by itself.",
  "Do not write patterns like 'label (elm[...])', 'label, elm[...]', 'elm[...] (label)', or quoted labels adjacent to elm[...] references.",
  "Do not add parenthetical or appositive annotations around elm[...] references unless the user explicitly asks for raw identifiers or notation details.",
  "If you need to identify a specific element, use elm[...] alone rather than combining it with the visible label, because the UI already renders the label.",
  "The user is not familiar with the elm[...] notation. Never ask the user to write, provide, or learn elm[...] references.",
  "Never ask the user to answer in forms such as 'elm[...]' or to identify an edge or node by raw internal ID unless they explicitly ask for IDs.",
  "If the user refers to a node or edge ambiguously, ask a natural-language clarification question based on visible labels, text, relative position, connections, or surrounding structure.",
  "Do not explain the elm[...] notation unless the user explicitly asks about it.",
  "In user-facing prose, do not dump raw edge IDs or node IDs unless they are necessary for precision and there is no clearer wording available.",
  "When explaining the structure, clearly indicate nodes, edges, directions, and relative positions.",
  "Respond in the user's language.",
  "Keep your responses specific and concise.",
  "If a user message starts with [audio input], treat it as speech-to-text and account for possible transcription variations.",
].join("\n");

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createThreadId() {
  return `thread-${createMessageId()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isSupportedShape(value: unknown): value is SupportedShape {
  return typeof value === "string" && DOCUMENT_SHAPES.includes(value as SupportedShape);
}

function isMermaidDirection(value: unknown): value is MermaidDirection {
  return typeof value === "string" && MERMAID_DIRECTIONS.includes(value as MermaidDirection);
}

function normalizeTranscriptionText(value: string, locale: string | undefined) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const isCjkLocale =
    Boolean(locale?.toLowerCase().startsWith("ja")) ||
    Boolean(locale?.toLowerCase().startsWith("zh")) ||
    Boolean(locale?.toLowerCase().startsWith("ko"));
  if (isCjkLocale) {
    return trimmed.replace(/\s+/g, "");
  }
  if (CJK_CHAR_PATTERN.test(trimmed)) {
    return trimmed.replace(
      /([\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])\s+([\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])/g,
      "$1$2",
    );
  }
  return trimmed;
}

function parsePositionedNodeInputs(args: unknown): PositionedShapeNodeInput[] {
  if (!isRecord(args) || !Array.isArray(args.nodes) || args.nodes.length === 0) {
    throw new Error("'nodes' must be a non-empty array.");
  }

  return args.nodes.map((node, index) => {
    if (!isRecord(node)) {
      throw new Error(`nodes[${index}] must be an object.`);
    }

    const { x, y, shape, text } = node;
    if (typeof x !== "number" || !Number.isFinite(x)) {
      throw new Error(`nodes[${index}].x must be a finite number.`);
    }
    if (typeof y !== "number" || !Number.isFinite(y)) {
      throw new Error(`nodes[${index}].y must be a finite number.`);
    }
    if (!isSupportedShape(shape)) {
      throw new Error(`nodes[${index}].shape must be one of ${DOCUMENT_SHAPES.join(", ")}.`);
    }
    if (typeof text !== "string" || !text.trim()) {
      throw new Error(`nodes[${index}].text must be a non-empty string.`);
    }

    return {
      x,
      y,
      shape,
      text: text.trim(),
    };
  });
}

function parseDerivedNodeArgs(args: unknown): {
  sourceNodeId: string;
  nodes: DerivedShapeNodeInput[];
  direction?: MermaidDirection;
} {
  if (!isRecord(args)) {
    throw new Error("Arguments must be an object.");
  }
  if (typeof args.sourceNodeId !== "string" || !args.sourceNodeId.trim()) {
    throw new Error("'sourceNodeId' must be a non-empty string.");
  }
  if (!Array.isArray(args.nodes) || args.nodes.length === 0) {
    throw new Error("'nodes' must be a non-empty array.");
  }

  return {
    sourceNodeId: args.sourceNodeId.trim(),
    direction: isMermaidDirection(args.direction) ? args.direction : undefined,
    nodes: args.nodes.map((node, index) => {
      if (!isRecord(node)) {
        throw new Error(`nodes[${index}] must be an object.`);
      }
      if (!isSupportedShape(node.shape)) {
        throw new Error(`nodes[${index}].shape must be one of ${DOCUMENT_SHAPES.join(", ")}.`);
      }
      if (typeof node.text !== "string" || !node.text.trim()) {
        throw new Error(`nodes[${index}].text must be a non-empty string.`);
      }

      return {
        shape: node.shape,
        text: node.text.trim(),
        edgeLabel:
          typeof node.edgeLabel === "string" && node.edgeLabel.trim()
            ? node.edgeLabel.trim()
            : undefined,
      };
    }),
  };
}

function parseDeleteNodeIds(args: unknown): string[] {
  if (!isRecord(args) || !Array.isArray(args.nodeIds) || args.nodeIds.length === 0) {
    throw new Error("'nodeIds' must be a non-empty array.");
  }

  const nodeIds = args.nodeIds.map((nodeId, index) => {
    if (typeof nodeId !== "string" || !nodeId.trim()) {
      throw new Error(`nodeIds[${index}] must be a non-empty string.`);
    }
    return nodeId.trim();
  });

  return Array.from(new Set(nodeIds));
}

function parseNodeEditArgs(args: unknown): { nodeIds: string[]; changes: NodeEditChanges } {
  if (!isRecord(args) || !Array.isArray(args.nodeIds) || !isRecord(args.changes)) {
    throw new Error("'nodeIds' and 'changes' are required.");
  }

  const nodeIds = args.nodeIds.map((nodeId, index) => {
    if (typeof nodeId !== "string" || !nodeId.trim()) {
      throw new Error(`nodeIds[${index}] must be a non-empty string.`);
    }
    return nodeId.trim();
  });

  if (!nodeIds.length) {
    throw new Error("'nodeIds' must be a non-empty array.");
  }

  const changes: NodeEditChanges = {};
  if (typeof args.changes.text === "string") {
    changes.text = args.changes.text;
  }
  if (isSupportedShape(args.changes.shape)) {
    changes.shape = args.changes.shape;
  } else if (typeof args.changes.shape !== "undefined") {
    throw new Error(`changes.shape must be one of ${DOCUMENT_SHAPES.join(", ")}.`);
  }
  if (typeof args.changes.color === "string" && args.changes.color.trim()) {
    changes.color = args.changes.color.trim();
  } else if (typeof args.changes.color !== "undefined") {
    throw new Error("changes.color must be a non-empty string.");
  }

  return { nodeIds: Array.from(new Set(nodeIds)), changes };
}

function isEdgeShape(value: unknown): value is EdgeShape {
  return typeof value === "string" && EDGE_SHAPES.includes(value as EdgeShape);
}

function isEdgeArrowEdit(value: unknown): value is EdgeArrowEdit {
  return typeof value === "string" && EDGE_ARROW_EDITS.includes(value as EdgeArrowEdit);
}

function parseEdgeEditArgs(args: unknown): { edgeIds: string[]; changes: EdgeEditChanges } {
  if (!isRecord(args) || !Array.isArray(args.edgeIds) || !isRecord(args.changes)) {
    throw new Error("'edgeIds' and 'changes' are required.");
  }

  const edgeIds = args.edgeIds.map((edgeId, index) => {
    if (typeof edgeId !== "string" || !edgeId.trim()) {
      throw new Error(`edgeIds[${index}] must be a non-empty string.`);
    }
    return edgeId.trim();
  });

  if (!edgeIds.length) {
    throw new Error("'edgeIds' must be a non-empty array.");
  }

  const changes: EdgeEditChanges = {};
  if (typeof args.changes.color === "string" && args.changes.color.trim()) {
    changes.color = args.changes.color.trim();
  } else if (typeof args.changes.color !== "undefined") {
    throw new Error("changes.color must be a non-empty string.");
  }
  if (isEdgeShape(args.changes.shape)) {
    changes.shape = args.changes.shape;
  } else if (typeof args.changes.shape !== "undefined") {
    throw new Error(`changes.shape must be one of ${EDGE_SHAPES.join(", ")}.`);
  }
  if (isEdgeArrowEdit(args.changes.arrow)) {
    changes.arrow = args.changes.arrow;
  } else if (typeof args.changes.arrow !== "undefined") {
    throw new Error(`changes.arrow must be one of ${EDGE_ARROW_EDITS.join(", ")}.`);
  }

  return { edgeIds: Array.from(new Set(edgeIds)), changes };
}

function parseMermaidGraphArgs(args: unknown): {
  mermaidText: string;
  centerX: number;
  centerY: number;
} {
  if (!isRecord(args)) {
    throw new Error("Arguments must be an object.");
  }

  if (typeof args.mermaidText !== "string" || !args.mermaidText.trim()) {
    throw new Error("'mermaidText' must be a non-empty string.");
  }

  if (!isRecord(args.center)) {
    throw new Error("'center' must be an object with x and y.");
  }

  if (typeof args.center.x !== "number" || !Number.isFinite(args.center.x)) {
    throw new Error("center.x must be a finite number.");
  }

  if (typeof args.center.y !== "number" || !Number.isFinite(args.center.y)) {
    throw new Error("center.y must be a finite number.");
  }

  return {
    mermaidText: args.mermaidText.trim(),
    centerX: args.center.x,
    centerY: args.center.y,
  };
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

function getChatHistoryStorageKey(activeDocId?: string) {
  return `${CHAT_HISTORY_STORAGE_KEY_PREFIX}.${activeDocId?.trim() || "default"}`;
}

function normalizeChatHistoryDocId(activeDocId?: string) {
  return activeDocId?.trim() || "default";
}

function loadStoredChatHistory(activeDocId?: string) {
  if (typeof window === "undefined") {
    return normalizeChatHistory(null);
  }

  try {
    const raw = window.localStorage.getItem(getChatHistoryStorageKey(activeDocId));
    if (!raw) return normalizeChatHistory(null);
    return normalizeChatHistory(JSON.parse(raw) as unknown);
  } catch {
    window.localStorage.removeItem(getChatHistoryStorageKey(activeDocId));
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

function appendMessagesToThread(
  state: ChatHistoryState,
  threadId: string,
  messages: Array<ChatMessage>,
  opts?: {
    title?: string;
    createdAt?: number;
    updatedAt?: number;
    activeThreadId?: string;
  },
): ChatHistoryState {
  const currentThread = state.threads.find((thread) => thread.id === threadId);
  const fallbackThread = createEmptyThread(opts?.title);
  const baseThread = currentThread ?? fallbackThread;

  return upsertThread(
    state,
    {
      ...baseThread,
      id: threadId,
      title: opts?.title ?? baseThread.title,
      createdAt: opts?.createdAt ?? currentThread?.createdAt ?? fallbackThread.createdAt,
      updatedAt: opts?.updatedAt ?? Date.now(),
      messages: [...(currentThread?.messages ?? baseThread.messages), ...messages],
    },
    opts?.activeThreadId ?? state.activeThreadId,
  );
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
  setDoc,
  setSelection,
  onElementReferenceActivate,
}: ChatSidePanelProps) {
  const conversationRef = React.useRef<HTMLDivElement | null>(null);
  const toolAnimationFrameRef = React.useRef<number | null>(null);
  const docRef = React.useRef(doc);
  const selectedNodeIdRef = React.useRef<string | null>(selectedNode?.id ?? null);
  const selectedEdgeIdRef = React.useRef<string | null>(selectedEdge?.id ?? null);
  const wasActiveRef = React.useRef(isActive);
  const [savedConfig, setSavedConfig] = React.useState(() => loadSavedLLMConfig());
  const [draftConfig, setDraftConfig] = React.useState<EditableLLMConfig>(() =>
    createEditableLLMConfig(loadSavedLLMConfig()),
  );
  const normalizedActiveDocId = React.useMemo(
    () => normalizeChatHistoryDocId(activeDocId),
    [activeDocId],
  );
  const [chatHistory, setChatHistory] = React.useState<ChatHistoryState>(() =>
    loadStoredChatHistory(activeDocId),
  );
  const [chatHistoryDocId, setChatHistoryDocId] = React.useState(normalizedActiveDocId);
  const [panelView, setPanelView] = React.useState<ChatPanelView>("threads");
  const [draft, setDraft] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [threadPendingDelete, setThreadPendingDelete] = React.useState<ChatThread | null>(null);
  const [isTranscribing, setIsTranscribing] = React.useState(false);
  const [transcriptionError, setTranscriptionError] = React.useState<string | null>(null);
  const [isTranscriptionSupported, setIsTranscriptionSupported] = React.useState(true);
  const [micEnabled, setMicEnabled] = React.useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("atlas.mic.enabled") === "true";
  });
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const mediaStreamRef = React.useRef<MediaStream | null>(null);
  const transcribeSocketRef = React.useRef<WebSocket | null>(null);
  const recordedChunksRef = React.useRef<Blob[]>([]);
  const lastTranscriptRef = React.useRef<string | null>(null);
  const sendAfterStopRef = React.useRef(false);
  const autoSendContentRef = React.useRef<string | null>(null);
  const [autoSendPending, setAutoSendPending] = React.useState(false);
  const visibleChatHistory =
    chatHistoryDocId === normalizedActiveDocId ? chatHistory : normalizeChatHistory(null);
  const activeThread = React.useMemo(
    () =>
      visibleChatHistory.threads.find(
        (thread) => thread.id === visibleChatHistory.activeThreadId,
      ) ?? visibleChatHistory.threads[0],
    [visibleChatHistory],
  );
  const messages = React.useMemo(() => activeThread?.messages ?? [], [activeThread]);
  const displayItems = React.useMemo(() => groupMessagesForDisplay(messages), [messages]);
  const isChatInputActive = isActive && panelView === "conversation";

  React.useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const supported =
      "MediaRecorder" in window && typeof navigator?.mediaDevices?.getUserMedia === "function";
    setIsTranscriptionSupported(supported);
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => {
      setMicEnabled(window.localStorage.getItem("atlas.mic.enabled") === "true");
    };

    update();
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("storage", update);
    };
  }, []);

  React.useEffect(() => {
    selectedNodeIdRef.current = selectedNode?.id ?? null;
    selectedEdgeIdRef.current = selectedEdge?.id ?? null;
  }, [selectedEdge?.id, selectedNode?.id]);

  React.useEffect(() => {
    return () => {
      cancelNodeAnimation(toolAnimationFrameRef);
    };
  }, []);

  const replaceTranscript = React.useCallback((text: string) => {
    const normalized = normalizeTranscriptionText(
      text,
      typeof navigator !== "undefined" ? navigator.language : undefined,
    );
    if (!normalized) return;
    const spacer = CJK_CHAR_PATTERN.test(normalized) ? "" : " ";
    const nextSegment = `${AUDIO_INPUT_PREFIX}${normalized}`;

    setDraft((current) => {
      if (lastTranscriptRef.current) {
        const escaped = lastTranscriptRef.current.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(`${escaped}$`);
        const next = current.replace(pattern, nextSegment);
        lastTranscriptRef.current = nextSegment;
        const resolved = next === current ? `${current}${spacer}${nextSegment}` : next;
        if (sendAfterStopRef.current) {
          autoSendContentRef.current = resolved;
          setAutoSendPending(true);
          sendAfterStopRef.current = false;
        }
        return resolved;
      }

      lastTranscriptRef.current = nextSegment;
      const resolved = current ? `${current}${spacer}${nextSegment}` : nextSegment;
      if (sendAfterStopRef.current) {
        autoSendContentRef.current = resolved;
        setAutoSendPending(true);
        sendAfterStopRef.current = false;
      }
      return resolved;
    });
  }, []);

  const sendChunkToSocket = React.useCallback((payload: Blob) => {
    if (!payload || payload.size === 0) return;
    const socket = transcribeSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    void payload
      .arrayBuffer()
      .then((buffer) => {
        socket.send(buffer);
      })
      .catch(() => {
        setTranscriptionError("音声データの送信に失敗しました。");
      });
  }, []);

  const stopTranscription = React.useCallback((options?: { reason?: "gesture" | "manual" }) => {
    const reason = options?.reason ?? "manual";
    const shouldAutoSend = reason === "gesture";
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    if (!shouldAutoSend) {
      lastTranscriptRef.current = null;
      recordedChunksRef.current = [];
    }
    if (shouldAutoSend) {
      sendAfterStopRef.current = true;
    } else if (transcribeSocketRef.current) {
      try {
        transcribeSocketRef.current.close();
      } catch {
        // ignore
      }
      transcribeSocketRef.current = null;
    }
    setIsTranscribing(false);
  }, []);

  const startTranscription = React.useCallback(async () => {
    if (!isChatInputActive) return;
    if (isTranscribing) return;
    if (typeof navigator === "undefined") return;
    if (!micEnabled) {
      setTranscriptionError("マイクがオフになっています。");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setTranscriptionError("このブラウザは音声入力に対応していません。");
      return;
    }

    try {
      setTranscriptionError(null);
      const wsUrl = new URL("/api/transcribe/ws", window.location.href);
      wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(wsUrl);
      transcribeSocketRef.current = socket;

      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        try {
          const payload = JSON.parse(event.data) as {
            transcript?: string;
            isPartial?: boolean;
            error?: string;
          };
          if (payload.error) {
            setTranscriptionError(payload.error);
            stopTranscription({ reason: "manual" });
            return;
          }
          if (payload.transcript) {
            replaceTranscript(payload.transcript);
          }
        } catch {
          // ignore parse errors
        }
      };

      socket.onerror = () => {
        setTranscriptionError("音声入力サーバーとの接続に失敗しました。");
        stopTranscription({ reason: "manual" });
      };

      socket.onclose = () => {
        if (isTranscribing) {
          setTranscriptionError("音声入力サーバーとの接続が切断されました。");
          stopTranscription({ reason: "manual" });
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const preferredTypes = [
        "audio/ogg;codecs=opus",
        "audio/ogg",
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
      ];
      const mimeType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type)) || "";

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      recordedChunksRef.current = [];

      const sendConfig = () => {
        if (socket.readyState !== WebSocket.OPEN) return;
        const languageHint = typeof navigator !== "undefined" ? navigator.language : "";
        const resolvedType = recorder.mimeType || mimeType || "audio/webm";
        socket.send(
          JSON.stringify({
            type: "config",
            language: languageHint || undefined,
            detectLanguage: true,
            contentType: resolvedType,
          }),
        );
      };

      socket.onopen = () => {
        if (recorder.state === "recording") {
          sendConfig();
        }
      };

      recorder.onstart = () => {
        sendConfig();
      };

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
          const snapshot = new Blob(recordedChunksRef.current, {
            type: recorder.mimeType || mimeType || "audio/webm",
          });
          sendChunkToSocket(snapshot);
        }
      };

      recorder.onstop = () => {
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      };

      recorder.start(1500);
      setIsTranscribing(true);
    } catch (caughtError) {
      setTranscriptionError(
        caughtError instanceof Error ? caughtError.message : "マイクの使用に失敗しました。",
      );
      stopTranscription({ reason: "manual" });
    }
  }, [
    isChatInputActive,
    isTranscribing,
    micEnabled,
    replaceTranscript,
    sendChunkToSocket,
    stopTranscription,
  ]);

  const toggleTranscription = React.useCallback(() => {
    if (isTranscribing) {
      stopTranscription({ reason: "manual" });
    } else {
      void startTranscription();
    }
  }, [isTranscribing, startTranscription, stopTranscription]);

  React.useEffect(() => {
    return () => {
      stopTranscription({ reason: "manual" });
    };
  }, [stopTranscription]);

  React.useEffect(() => {
    const unsubscribe = subscribeVoiceInputToggle((event) => {
      if (event.source !== "gesture") return;
      if (!isChatInputActive) return;
      if (!isTranscriptionSupported || !micEnabled) return;
      if (isTranscribing) {
        stopTranscription({ reason: "gesture" });
      } else {
        void startTranscription();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [
    isChatInputActive,
    isTranscribing,
    isTranscriptionSupported,
    micEnabled,
    startTranscription,
    stopTranscription,
  ]);

  React.useEffect(() => {
    if ((!micEnabled || !isChatInputActive) && isTranscribing) {
      stopTranscription({ reason: "manual" });
    }
  }, [isChatInputActive, isTranscribing, micEnabled, stopTranscription]);

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
              doc: docRef.current,
              activeDocId,
              selectedNodeId: selectedNodeIdRef.current,
              selectedEdgeId: selectedEdgeIdRef.current,
            }),
            null,
            2,
          ),
      },
      {
        name: "create_document_nodes",
        description:
          "Create one or more shape nodes from explicit top-left world coordinates, shape, and text. Use this for direct placement without layout animation.",
        inputSchema: {
          type: "object",
          properties: {
            nodes: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                properties: {
                  x: { type: "number" },
                  y: { type: "number" },
                  shape: { type: "string", enum: [...DOCUMENT_SHAPES] },
                  text: { type: "string" },
                },
                required: ["x", "y", "shape", "text"],
                additionalProperties: false,
              },
            },
          },
          required: ["nodes"],
          additionalProperties: false,
        },
        execute: async (args) => {
          const nodes = parsePositionedNodeInputs(args);
          const result = createPositionedShapeNodes(docRef.current, nodes);
          docRef.current = result.nextDoc;
          setDoc(result.nextDoc);
          setSelection({ kind: "none" });

          return JSON.stringify(
            {
              ok: true,
              createdNodeIds: result.createdNodeIds,
              createdNodes: result.createdNodeIds.map((nodeId) => {
                const node = result.createdNodes[nodeId];
                return {
                  id: node.id,
                  x: node.x,
                  y: node.y,
                  w: node.w,
                  h: node.h,
                  shape: node.props.shape,
                  text: node.props.text,
                };
              }),
            },
            null,
            2,
          );
        },
      },
      {
        name: "derive_document_nodes_from_node",
        description:
          "Create one or more new child nodes from an existing source node id. Atlas will place and animate them using its Mermaid flowchart layout engine, so coordinates must not be provided.",
        inputSchema: {
          type: "object",
          properties: {
            sourceNodeId: { type: "string" },
            direction: { type: "string", enum: [...MERMAID_DIRECTIONS] },
            nodes: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                properties: {
                  shape: { type: "string", enum: [...DOCUMENT_SHAPES] },
                  text: { type: "string" },
                  edgeLabel: { type: "string" },
                },
                required: ["shape", "text"],
                additionalProperties: false,
              },
            },
          },
          required: ["sourceNodeId", "nodes"],
          additionalProperties: false,
        },
        execute: async (args) => {
          const parsed = parseDerivedNodeArgs(args);
          const result = createDerivedNodesFromSource({
            doc: docRef.current,
            sourceNodeId: parsed.sourceNodeId,
            nodes: parsed.nodes,
            direction: parsed.direction,
          });

          docRef.current = result.nextDoc;
          setDoc(result.nextDoc);
          setSelection({ kind: "none" });
          runNodeAnimation({
            frameRef: toolAnimationFrameRef,
            setDoc,
            startPositions: collectNodeStartPositions(result.createdNodes, result.createdNodeIds),
            animation: result.animation,
          });

          return JSON.stringify(
            {
              ok: true,
              engine: result.engine,
              sourceNodeId: parsed.sourceNodeId,
              createdNodeIds: result.createdNodeIds,
              createdEdgeIds: result.createdEdgeIds,
              createdNodes: result.createdNodeIds.map((nodeId) => {
                const node = result.createdNodes[nodeId];
                return {
                  id: node.id,
                  shape: node.props.shape,
                  text: node.props.text,
                  targetX: result.animation.targetPositions[nodeId]?.x ?? node.x,
                  targetY: result.animation.targetPositions[nodeId]?.y ?? node.y,
                };
              }),
            },
            null,
            2,
          );
        },
      },
      {
        name: "create_mermaid_graph_at_center",
        description:
          "Build a full Mermaid graph from source text and place it so its bounds are centered on the given world coordinate. Always animates into place.",
        inputSchema: {
          type: "object",
          properties: {
            mermaidText: { type: "string" },
            center: {
              type: "object",
              properties: {
                x: { type: "number" },
                y: { type: "number" },
              },
              required: ["x", "y"],
              additionalProperties: false,
            },
          },
          required: ["mermaidText", "center"],
          additionalProperties: false,
        },
        execute: async (args) => {
          const parsed = parseMermaidGraphArgs(args);
          const built = buildMermaidElements(parsed.mermaidText, {
            existingNodeIds: new Set(Object.keys(docRef.current.nodes)),
            existingEdgeIds: new Set(Object.keys(docRef.current.edges)),
            idPrefix: "",
            animateIn: true,
          });

          if (built.nodeOrder.length === 0) {
            throw new Error("No nodes were found in the Mermaid source.");
          }

          const centered = centerMermaidBuildResultOnPoint(built, {
            x: parsed.centerX,
            y: parsed.centerY,
          });

          const nextDoc = mergeMermaidBuildResultIntoDocument(docRef.current, centered);
          docRef.current = nextDoc;
          setDoc(nextDoc);
          setSelection({ kind: "none" });

          if (centered.animation) {
            runNodeAnimation({
              frameRef: toolAnimationFrameRef,
              setDoc,
              startPositions: collectNodeStartPositions(centered.nodes, centered.nodeOrder),
              animation: centered.animation,
            });
          }

          return JSON.stringify(
            {
              ok: true,
              createdNodeIds: centered.nodeOrder,
              createdEdgeIds: centered.edgeOrder,
              bounds: centered.bounds,
              center: { x: parsed.centerX, y: parsed.centerY },
            },
            null,
            2,
          );
        },
      },
      {
        name: "delete_document_nodes",
        description:
          "Delete one or more nodes by id. Connected edges are removed automatically. Accepts arrays of any length including one.",
        inputSchema: {
          type: "object",
          properties: {
            nodeIds: {
              type: "array",
              minItems: 1,
              items: { type: "string" },
            },
          },
          required: ["nodeIds"],
          additionalProperties: false,
        },
        execute: async (args) => {
          const nodeIds = parseDeleteNodeIds(args);
          const result = deleteNodesById(docRef.current, nodeIds);
          docRef.current = result.nextDoc;
          setDoc(result.nextDoc);
          setSelection({ kind: "none" });

          return JSON.stringify(
            {
              ok: true,
              removedNodeIds: result.removedNodeIds,
              removedEdgeIds: result.removedEdgeIds,
              missingNodeIds: result.missingNodeIds,
            },
            null,
            2,
          );
        },
      },
      {
        name: "edit_document_nodes",
        description:
          "Edit one or more existing nodes by id. Provide nodeIds and a changes object. Omitted keys are left unchanged.",
        inputSchema: {
          type: "object",
          properties: {
            nodeIds: {
              type: "array",
              minItems: 1,
              items: { type: "string" },
            },
            changes: {
              type: "object",
              properties: {
                text: { type: "string" },
                color: { type: "string" },
                shape: { type: "string", enum: [...DOCUMENT_SHAPES] },
              },
              additionalProperties: false,
            },
          },
          required: ["nodeIds", "changes"],
          additionalProperties: false,
        },
        execute: async (args) => {
          const parsed = parseNodeEditArgs(args);
          const result = editNodesById(docRef.current, parsed.nodeIds, parsed.changes);
          docRef.current = result.nextDoc;
          setDoc(result.nextDoc);

          return JSON.stringify(
            {
              ok: true,
              updatedNodeIds: result.updatedNodeIds,
              missingNodeIds: result.missingNodeIds,
              skippedNodeIds: result.skippedNodeIds,
              changes: parsed.changes,
            },
            null,
            2,
          );
        },
      },
      {
        name: "edit_document_edges",
        description:
          "Edit one or more existing edges by id. Provide edgeIds and a changes object. Omitted keys are left unchanged.",
        inputSchema: {
          type: "object",
          properties: {
            edgeIds: {
              type: "array",
              minItems: 1,
              items: { type: "string" },
            },
            changes: {
              type: "object",
              properties: {
                color: { type: "string" },
                shape: { type: "string", enum: [...EDGE_SHAPES] },
                arrow: { type: "string", enum: [...EDGE_ARROW_EDITS] },
              },
              additionalProperties: false,
            },
          },
          required: ["edgeIds", "changes"],
          additionalProperties: false,
        },
        execute: async (args) => {
          const parsed = parseEdgeEditArgs(args);
          const result = editEdgesById(docRef.current, parsed.edgeIds, parsed.changes);
          docRef.current = result.nextDoc;
          setDoc(result.nextDoc);

          return JSON.stringify(
            {
              ok: true,
              updatedEdgeIds: result.updatedEdgeIds,
              missingEdgeIds: result.missingEdgeIds,
              skippedEdgeIds: result.skippedEdgeIds,
              changes: parsed.changes,
            },
            null,
            2,
          );
        },
      },
    ],
    [activeDocId, setDoc, setSelection],
  );

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      getChatHistoryStorageKey(chatHistoryDocId),
      JSON.stringify(chatHistory),
    );
  }, [chatHistory, chatHistoryDocId]);

  React.useEffect(() => {
    setChatHistory(loadStoredChatHistory(activeDocId));
    setChatHistoryDocId(normalizedActiveDocId);
    setPanelView("threads");
    setDraft("");
    setError(null);
    setThreadPendingDelete(null);
  }, [activeDocId, normalizedActiveDocId]);

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

  React.useEffect(() => {
    if (!isActive && isTranscribing) {
      stopTranscription({ reason: "manual" });
    }
  }, [isActive, isTranscribing, stopTranscription]);

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

      const thread = visibleChatHistory.threads.find((entry) => entry.id === threadId) ?? null;
      setThreadPendingDelete(thread);
    },
    [isSubmitting, visibleChatHistory.threads],
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

  const sendMessage = React.useCallback(
    async (overrideContent?: string) => {
      if (!hasCompleteLLMConfig(savedConfig)) {
        setError("設定を保存してください。");
        return;
      }

      const content = (overrideContent ?? draft).trim();
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
            title:
              currentTitle === EMPTY_THREAD_TITLE ? summarizeThread(nextMessages) : currentTitle,
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
        const resolvedTitle =
          currentTitle === EMPTY_THREAD_TITLE ? summarizeThread(nextMessages) : currentTitle;

        const result = await runLLMSession({
          provider: savedConfig.provider,
          model: savedConfig.model,
          token: savedConfig.token,
          systemPrompt: ATLAS_CHAT_SYSTEM_PROMPT,
          messages: llmMessages,
          tools: llmTools,
          onMessage: async (message) => {
            const chatMessages = llmMessageToChatMessages(message);
            if (!chatMessages.length) return;

            setChatHistory((current) =>
              appendMessagesToThread(current, threadId, chatMessages, {
                title: resolvedTitle,
                createdAt: activeThread?.createdAt ?? now,
                updatedAt: Date.now(),
                activeThreadId: threadId,
              }),
            );
          },
        });

        const assistantContent = result.assistantMessage.content.trim();
        if (!assistantContent) {
          throw new Error("LLM returned an empty response.");
        }
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "LLM request failed.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [activeThread, draft, isSubmitting, llmTools, savedConfig],
  );

  React.useEffect(() => {
    if (!autoSendPending) return;
    const content = autoSendContentRef.current;
    autoSendContentRef.current = null;

    const finalize = () => {
      if (transcribeSocketRef.current) {
        try {
          transcribeSocketRef.current.close();
        } catch {
          // ignore
        }
      }
      transcribeSocketRef.current = null;
      lastTranscriptRef.current = null;
      recordedChunksRef.current = [];
      setAutoSendPending(false);
    };

    if (!content) {
      finalize();
      return;
    }

    void (async () => {
      await sendMessage(content);
      finalize();
    })();
  }, [autoSendPending, sendMessage]);

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
              {visibleChatHistory.threads.map((thread) => {
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
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="xs"
              variant={isTranscribing ? "default" : "outline"}
              onClick={toggleTranscription}
              disabled={!isTranscriptionSupported || !micEnabled || isSubmitting}
            >
              {isTranscribing ? (
                <SquareIcon className="size-3.5" />
              ) : (
                <MicIcon className="size-3.5" />
              )}
              {isTranscribing ? "録音停止" : "音声入力"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {isTranscribing
                ? "音声を文字起こししています..."
                : "マイク入力でリアルタイム文字起こしが可能です。"}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">Enter で送信、Shift+Enter で改行</div>
          {transcriptionError ? (
            <div className="text-xs text-destructive">{transcriptionError}</div>
          ) : null}
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
