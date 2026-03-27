import * as React from "react";

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
import {
  createEditableLLMConfig,
  hasCompleteLLMConfig,
  LLM_DEFAULT_MODELS,
  LLM_MODELS_BY_PROVIDER,
  loadSavedLLMConfig,
  saveLLMConfig,
  type LLMProvider,
} from "@/lib/llm-config";
import { cn } from "@/lib/utils";
import {
  ChevronLeftIcon,
  ListIcon,
  MessageSquareIcon,
  PlusIcon,
  Settings2Icon,
  Trash2Icon,
} from "lucide-react";
import type { ChatSidePanelProps } from "./types";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

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

type StreamEvent =
  | { event: "delta"; payload: { delta?: string } }
  | { event: "ready"; payload: Record<string, never> }
  | { event: "done"; payload: Record<string, never> }
  | { event: "error"; payload: { error?: string } };

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createThreadId() {
  return `thread-${createMessageId()}`;
}

function sanitizeMessages(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value.filter(
    (message): message is ChatMessage =>
      !!message &&
      typeof message === "object" &&
      "id" in message &&
      "role" in message &&
      "content" in message &&
      typeof message.id === "string" &&
      (message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string",
  );
}

function summarizeThread(messages: Array<ChatMessage>) {
  const firstUserMessage = messages.find(
    (message) => message.role === "user" && message.content.trim(),
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
  const lastMessage = [...thread.messages].reverse().find((message) => message.content.trim());
  if (!lastMessage) return "まだメッセージはありません";

  const normalized = lastMessage.content.replace(/\s+/g, " ").trim();
  return normalized.length > 48 ? `${normalized.slice(0, 48)}...` : normalized;
}

async function* readSseStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      let boundaryIndex = buffer.indexOf("\n\n");

      while (boundaryIndex >= 0) {
        const rawEvent = buffer.slice(0, boundaryIndex);
        buffer = buffer.slice(boundaryIndex + 2);

        const lines = rawEvent.split("\n");
        const eventLine = lines.find((line) => line.startsWith("event:"));
        const data = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");

        if (eventLine && data) {
          const event = eventLine.slice(6).trim() as StreamEvent["event"];
          const payload = JSON.parse(data) as StreamEvent["payload"];
          yield { event, payload } as StreamEvent;
        }

        boundaryIndex = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
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

export function ChatSidePanel({ selectedNode, isActive }: ChatSidePanelProps) {
  void selectedNode;
  const conversationRef = React.useRef<HTMLDivElement | null>(null);
  const wasActiveRef = React.useRef(isActive);
  const streamBufferRef = React.useRef("");
  const streamFrameRef = React.useRef<number | null>(null);
  const activeAssistantMessageIdRef = React.useRef<string | null>(null);
  const activeAssistantThreadIdRef = React.useRef<string | null>(null);
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
  const [activeAssistantMessageId, setActiveAssistantMessageId] = React.useState<string | null>(
    null,
  );
  const [threadPendingDelete, setThreadPendingDelete] = React.useState<ChatThread | null>(null);
  const activeThread = React.useMemo(
    () =>
      chatHistory.threads.find((thread) => thread.id === chatHistory.activeThreadId) ??
      chatHistory.threads[0],
    [chatHistory],
  );
  const messages = React.useMemo(() => activeThread?.messages ?? [], [activeThread]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(chatHistory));
  }, [chatHistory]);

  React.useEffect(() => {
    const viewport = conversationRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [messages, activeAssistantMessageId]);

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

  const flushStreamBuffer = React.useCallback((threadId: string, assistantMessageId: string) => {
    const delta = streamBufferRef.current;
    if (!delta) return;

    streamBufferRef.current = "";
    React.startTransition(() => {
      setChatHistory((current) =>
        upsertThread(
          current,
          {
            ...(current.threads.find((thread) => thread.id === threadId) ?? createEmptyThread()),
            id: threadId,
            updatedAt: Date.now(),
            messages: (
              current.threads.find((thread) => thread.id === threadId)?.messages ?? []
            ).map((message) =>
              message.id === assistantMessageId
                ? { ...message, content: `${message.content}${delta}` }
                : message,
            ),
          },
          current.activeThreadId,
        ),
      );
    });
  }, []);

  const scheduleStreamFlush = React.useCallback(
    (threadId: string, assistantMessageId: string) => {
      if (streamFrameRef.current != null) return;
      streamFrameRef.current = window.requestAnimationFrame(() => {
        streamFrameRef.current = null;
        flushStreamBuffer(threadId, assistantMessageId);
      });
    },
    [flushStreamBuffer],
  );

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

    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content,
    };
    const assistantMessageId = createMessageId();
    activeAssistantMessageIdRef.current = assistantMessageId;
    activeAssistantThreadIdRef.current = threadId;
    const nextMessages = [...currentMessages, userMessage];

    setChatHistory((current) =>
      upsertThread(
        current,
        {
          id: threadId,
          title: currentTitle === EMPTY_THREAD_TITLE ? summarizeThread(nextMessages) : currentTitle,
          messages: [
            ...nextMessages,
            {
              id: assistantMessageId,
              role: "assistant",
              content: "",
            },
          ],
          createdAt: activeThread?.createdAt ?? now,
          updatedAt: now,
        },
        threadId,
      ),
    );
    setDraft("");
    setError(null);
    setIsSubmitting(true);
    setActiveAssistantMessageId(assistantMessageId);
    streamBufferRef.current = "";

    try {
      const response = await fetch("/api/llm/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          provider: savedConfig.provider,
          model: savedConfig.model,
          token: savedConfig.token,
          messages: nextMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "LLM request failed.");
      }

      if (!response.body) {
        throw new Error("Streaming response body is not available.");
      }

      let receivedAnyDelta = false;
      for await (const event of readSseStream(response.body)) {
        if (event.event === "ready") {
          continue;
        }

        if (event.event === "delta") {
          const delta = event.payload.delta ?? "";
          if (!delta) continue;
          receivedAnyDelta = true;
          streamBufferRef.current += delta;
          scheduleStreamFlush(threadId, assistantMessageId);
          continue;
        }

        if (event.event === "error") {
          throw new Error(event.payload.error || "LLM request failed.");
        }

        if (event.event === "done") {
          flushStreamBuffer(threadId, assistantMessageId);
          break;
        }
      }

      if (!receivedAnyDelta) {
        setChatHistory((current) =>
          upsertThread(
            current,
            {
              ...(current.threads.find((thread) => thread.id === threadId) ?? createEmptyThread()),
              id: threadId,
              updatedAt: Date.now(),
              messages: (
                current.threads.find((thread) => thread.id === threadId)?.messages ?? []
              ).filter((message) => message.id !== assistantMessageId),
            },
            current.activeThreadId,
          ),
        );
        throw new Error("LLM returned an empty response.");
      }
    } catch (caughtError) {
      if (streamFrameRef.current != null) {
        window.cancelAnimationFrame(streamFrameRef.current);
        streamFrameRef.current = null;
      }
      streamBufferRef.current = "";
      setChatHistory((current) =>
        upsertThread(
          current,
          {
            ...(current.threads.find((thread) => thread.id === threadId) ?? createEmptyThread()),
            id: threadId,
            updatedAt: Date.now(),
            messages: (
              current.threads.find((thread) => thread.id === threadId)?.messages ?? []
            ).filter((message) => message.content.trim() || message.role === "user"),
          },
          current.activeThreadId,
        ),
      );
      setError(caughtError instanceof Error ? caughtError.message : "LLM request failed.");
    } finally {
      if (streamFrameRef.current != null) {
        window.cancelAnimationFrame(streamFrameRef.current);
        streamFrameRef.current = null;
      }
      if (activeAssistantThreadIdRef.current && activeAssistantMessageIdRef.current) {
        flushStreamBuffer(activeAssistantThreadIdRef.current, activeAssistantMessageIdRef.current);
      }
      activeAssistantThreadIdRef.current = null;
      activeAssistantMessageIdRef.current = null;
      setActiveAssistantMessageId(null);
      setIsSubmitting(false);
    }
  }, [activeThread, draft, flushStreamBuffer, isSubmitting, savedConfig, scheduleStreamFlush]);

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
              {messages.length ? (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={
                      message.role === "assistant"
                        ? "rounded-md border bg-background px-3 py-2 text-sm whitespace-pre-wrap break-words"
                        : "rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground whitespace-pre-wrap break-words"
                    }
                  >
                    {message.content || message.id === activeAssistantMessageId ? (
                      <>
                        {message.content}
                        {message.id === activeAssistantMessageId ? (
                          <span className="ml-0.5 inline-block animate-pulse align-baseline">
                            |
                          </span>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                ))
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
