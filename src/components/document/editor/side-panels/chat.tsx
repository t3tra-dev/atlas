import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MessageSquareIcon } from "lucide-react";
import type { ChatSidePanelProps } from "./types";

export function ChatSidePanel({ selectedNode }: ChatSidePanelProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <MessageSquareIcon className="size-4" />
      </div>

      <div className="mt-3 text-xs text-muted-foreground">
        チャット連携のプレースホルダーです。
        <br />
        将来的にドキュメント文脈、選択ノード、操作履歴を接続できます。
      </div>

      <div className="mt-4 rounded-lg border bg-muted/30 p-3">
        <div className="text-xs font-medium text-muted-foreground">状態</div>
        <div className="mt-2 flex items-center justify-between rounded-md border bg-background px-3 py-2 text-sm">
          <span>Provider</span>
          <span className="text-xs text-muted-foreground">Not connected</span>
        </div>
        <div className="mt-2 flex items-center justify-between rounded-md border bg-background px-3 py-2 text-sm">
          <span>Context</span>
          <span className="text-xs text-muted-foreground">
            {selectedNode ? `Node ${selectedNode.id}` : "Canvas only"}
          </span>
        </div>
      </div>

      <div className="mt-4 flex-1 space-y-3 overflow-hidden">
        <div className="text-xs font-medium text-muted-foreground">Conversation</div>
        <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
          <div className="rounded-md bg-background px-3 py-2 text-sm">
            AIアシスタントの準備中です。
          </div>
          <div className="rounded-md border border-dashed bg-background px-3 py-3 text-sm text-muted-foreground">
            ここにスレッド、提案、ノード選択に応じた補助UIを表示します。
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-2 border-t pt-4">
        <Label htmlFor="atlas-chat-draft">Prompt</Label>
        <textarea
          id="atlas-chat-draft"
          className="min-h-28 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none"
          placeholder="Ask Atlas AI about this canvas..."
          disabled
        />
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled>
            New Thread
          </Button>
          <Button className="flex-1" disabled>
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
