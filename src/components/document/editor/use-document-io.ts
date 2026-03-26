import * as React from "react";

import {
  ATLAS_FILE_EXTENSION,
  createAtlasBlob,
  decodeAtlasDocument,
} from "@/components/document/atlas-binary";
import { buildMermaidElements } from "@/plugins/builtin/mermaid";
import type { Camera, DocumentModel, Selection, Tool } from "@/components/document/model";
import {
  clamp,
  computeBoundsFromNodes,
  downloadBlob,
  pickAtlasFile,
  sanitizeDocumentNameForFile,
  centerMermaidBuildResultOnCamera,
} from "@/components/document/editor/shared";

type SetDocument = (next: DocumentModel | ((prev: DocumentModel) => DocumentModel)) => void;

export function useDocumentIO({
  doc,
  camera,
  viewportSize,
  setDoc,
  setSelection,
  setTool,
}: {
  doc: DocumentModel;
  camera: Camera;
  viewportSize: { width: number; height: number };
  setDoc: SetDocument;
  setSelection: React.Dispatch<React.SetStateAction<Selection>>;
  setTool: React.Dispatch<React.SetStateAction<Tool>>;
}) {
  const mermaidAnimationFrameRef = React.useRef<number | null>(null);
  const [atlasIOError, setAtlasIOError] = React.useState<string | null>(null);
  const [mermaidDialog, setMermaidDialog] = React.useState<null | {
    error: string | null;
  }>(null);
  const [mermaidDraft, setMermaidDraft] = React.useState<string>("");

  const cancelMermaidAnimation = React.useCallback(() => {
    if (mermaidAnimationFrameRef.current != null) {
      window.cancelAnimationFrame(mermaidAnimationFrameRef.current);
      mermaidAnimationFrameRef.current = null;
    }
  }, [mermaidAnimationFrameRef]);

  const exportAtlas = React.useCallback(async () => {
    try {
      const targetDoc: DocumentModel = { ...doc, camera };
      const blob = createAtlasBlob(targetDoc);
      const fileName = `${sanitizeDocumentNameForFile(targetDoc.title)}${ATLAS_FILE_EXTENSION}`;
      downloadBlob(blob, fileName);
      setAtlasIOError(null);
    } catch (error) {
      setAtlasIOError(
        error instanceof Error
          ? `ATLAS書き出しに失敗しました: ${error.message}`
          : "ATLAS書き出しに失敗しました",
      );
    }
  }, [camera, doc]);

  const importAtlas = React.useCallback(async () => {
    try {
      const file = await pickAtlasFile();
      if (!file) return;

      const buffer = await file.arrayBuffer();
      const parsed = decodeAtlasDocument(buffer);
      setDoc(parsed);
      setSelection({ kind: "none" });
      setTool({ kind: "select" });
      setAtlasIOError(null);
    } catch (error) {
      setAtlasIOError(
        error instanceof Error
          ? `ATLAS読み込みに失敗しました: ${error.message}`
          : "ATLAS読み込みに失敗しました",
      );
    }
  }, [setDoc, setSelection, setTool]);

  const openMermaidImportDialog = React.useCallback(() => {
    const flowchartSource: string = `flowchart TD
    HQ[Headquarters] <--> Ops[Operations]
    HQ --> Intake{Intake}
    Intake --> API[API Gateway]
    Intake --> Batch[Batch Jobs]
    API --> Auth[Auth Service]
    API --> Tasks[Task Router]
    Tasks --> Web[Web Client]
    Tasks --> Mobile[Mobile App]
    Tasks --> Partner[Partner Feed]
    Batch --> Reports[Reporting]
    Batch --> Archive[(Archive)]
    Reports --- Archive
    Ops --> Monitor[Monitoring]
    Ops --> Alerts[Alerts]
    Monitor -.-> Tasks
    Alerts --> Mail[Email]
    Alerts --> Chat[ChatOps]
    Mail --- Chat`;
    setMermaidDraft(flowchartSource.trim());
    setMermaidDialog({ error: null });
  }, []);

  const onMermaidConfirm = React.useCallback(() => {
    const source = mermaidDraft.trim();
    if (!source) {
      setMermaidDialog({ error: "Mermaidコードを入力してください" });
      return;
    }

    cancelMermaidAnimation();
    const built = buildMermaidElements(source, {
      existingNodeIds: new Set(Object.keys(doc.nodes)),
      existingEdgeIds: new Set(Object.keys(doc.edges)),
      idPrefix: "mmd_",
      animateIn: true,
    });
    const result = centerMermaidBuildResultOnCamera(built, camera, viewportSize);

    if (result.nodeOrder.length === 0) {
      setMermaidDialog({ error: "ノードが見つかりませんでした" });
      return;
    }

    setDoc((d) => {
      const nextNodes = { ...d.nodes, ...result.nodes };
      const nextEdges = { ...d.edges, ...result.edges };
      const nodeOrder = [...d.nodeOrder, ...result.nodeOrder];
      const edgeOrder = [...d.edgeOrder, ...result.edgeOrder];

      const existingBounds = computeBoundsFromNodes(d.nodes);
      const bounds = result.bounds
        ? existingBounds
          ? {
              minX: Math.min(existingBounds.minX, result.bounds.minX),
              minY: Math.min(existingBounds.minY, result.bounds.minY),
              maxX: Math.max(existingBounds.maxX, result.bounds.maxX),
              maxY: Math.max(existingBounds.maxY, result.bounds.maxY),
            }
          : result.bounds
        : computeBoundsFromNodes(nextNodes);
      if (!bounds) {
        return {
          ...d,
          nodes: nextNodes,
          nodeOrder,
          edges: nextEdges,
          edgeOrder,
        };
      }

      const padding = 200;
      const nextWidth = Math.max(d.canvas.width, bounds.maxX - bounds.minX + padding * 2);
      const nextHeight = Math.max(d.canvas.height, bounds.maxY - bounds.minY + padding * 2);

      return {
        ...d,
        nodes: nextNodes,
        nodeOrder,
        edges: nextEdges,
        edgeOrder,
        canvas: { ...d.canvas, width: nextWidth, height: nextHeight },
      };
    });

    if (result.animation) {
      const startPositions = Object.fromEntries(
        result.nodeOrder
          .map((nodeId) => {
            const node = result.nodes[nodeId];
            if (!node) return null;
            return [nodeId, { x: node.x, y: node.y }] as const;
          })
          .filter((entry): entry is readonly [string, { x: number; y: number }] => entry != null),
      );

      const startedAt = performance.now();
      const step = (now: number) => {
        const rawProgress = (now - startedAt) / result.animation!.durationMs;
        const progress = clamp(rawProgress, 0, 1);
        const eased = 1 - (1 - progress) ** 3;

        setDoc((prev) => {
          let changed = false;
          const nextNodes = { ...prev.nodes };
          for (const nodeId of result.nodeOrder) {
            const node = nextNodes[nodeId];
            const start = startPositions[nodeId];
            const target = result.animation?.targetPositions[nodeId];
            if (!node || !start || !target) continue;
            const x = start.x + (target.x - start.x) * eased;
            const y = start.y + (target.y - start.y) * eased;
            if (node.x === x && node.y === y) continue;
            nextNodes[nodeId] = { ...node, x, y };
            changed = true;
          }

          return changed ? { ...prev, nodes: nextNodes } : prev;
        });

        if (progress < 1) {
          mermaidAnimationFrameRef.current = window.requestAnimationFrame(step);
          return;
        }

        mermaidAnimationFrameRef.current = null;
      };

      mermaidAnimationFrameRef.current = window.requestAnimationFrame(step);
    }

    setSelection({ kind: "none" });
    setTool({ kind: "select" });
    setMermaidDialog(null);
  }, [
    camera,
    cancelMermaidAnimation,
    doc.edges,
    doc.nodes,
    mermaidDraft,
    mermaidAnimationFrameRef,
    setDoc,
    setSelection,
    setTool,
    viewportSize,
  ]);

  return {
    atlasIOError,
    mermaidDialog,
    mermaidDraft,
    setMermaidDialog,
    setMermaidDraft,
    exportAtlas,
    importAtlas,
    openMermaidImportDialog,
    onMermaidConfirm,
    cancelMermaidAnimation,
  };
}
