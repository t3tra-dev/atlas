import * as React from "react";

import {
  ATLAS_FILE_EXTENSION,
  createAtlasBlob,
  decodeAtlasDocument,
} from "@/components/document/atlas-binary";
import { buildMermaidElements } from "@/plugins/builtin/mermaid";
import type { Camera, DocumentModel, Selection, Tool } from "@/components/document/model";
import {
  collectNodeStartPositions,
  mergeMermaidBuildResultIntoDocument,
  runNodeAnimation,
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
      idPrefix: "",
      animateIn: true,
    });
    const result = centerMermaidBuildResultOnCamera(built, camera, viewportSize);

    if (result.nodeOrder.length === 0) {
      setMermaidDialog({ error: "ノードが見つかりませんでした" });
      return;
    }

    setDoc((d) => mergeMermaidBuildResultIntoDocument(d, result));

    if (result.animation) {
      runNodeAnimation({
        frameRef: mermaidAnimationFrameRef,
        setDoc,
        startPositions: collectNodeStartPositions(result.nodes, result.nodeOrder),
        animation: result.animation,
      });
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
