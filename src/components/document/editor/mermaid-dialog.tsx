import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";

export function MermaidImportDialog({
  open,
  draft,
  error,
  onDraftChange,
  onClose,
  onConfirm,
}: {
  open: boolean;
  draft: string;
  error: string | null;
  onDraftChange: (next: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Mermaid読み込み</DialogTitle>
          <DialogDescription>Mermaidコードを貼り付けてノードと関係を追加します。</DialogDescription>
        </DialogHeader>

        <InputGroup
          label={<Label htmlFor="mermaid-input">Mermaidコード</Label>}
          description="flowchart / graph / mindmap 記法に対応"
        >
          <textarea
            id="mermaid-input"
            className="h-56 w-full resize-none rounded-md border bg-background p-3 font-mono text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder="flowchart TD\n  A --> B"
          />
        </InputGroup>

        {error ? <div className="text-sm text-destructive">{error}</div> : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            キャンセル
          </Button>
          <Button onClick={onConfirm}>読み込み</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
