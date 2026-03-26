import * as React from "react";

import type { DocumentSDK, GestureRegister } from "@/components/document/sdk";
import { createPluginHost, type PluginHost } from "@/components/document/plugin-system";
import { subscribeGestureFrame } from "@/components/vision/gesture-frame-bus";
import { BuiltinPlugin } from "@/plugins/builtin";
import { builtinGestureRegisters } from "@/plugins/builtin/gestures";
import type { DocumentModel, Selection, Tool, Camera } from "@/components/document/model";
import { cn } from "@/lib/utils";

function createEmptyPluginHost(): PluginHost {
  return {
    nodeRegistry: {
      get: () => undefined,
      list: () => [],
    },
    menus: {
      add: [],
      file: [],
      edit: [],
      view: [],
    },
    commands: {
      get: () => undefined,
      execute: () => {},
      list: () => [],
    },
    keybindings: [],
  };
}

export function useEditorRuntime({
  doc,
  selection,
  tool,
  camera,
  exportAtlas,
  importAtlas,
  openMermaidImportDialog,
  setDoc,
  setSelection,
  setTool,
  setCameraState,
  scheduleCameraCommit,
  zoomToCentered,
  activeDocId,
}: {
  doc: DocumentModel;
  selection: Selection;
  tool: Tool;
  camera: Camera;
  exportAtlas: () => Promise<void> | void;
  importAtlas: () => Promise<void> | void;
  openMermaidImportDialog: () => void;
  setDoc: (next: DocumentModel | ((prev: DocumentModel) => DocumentModel)) => void;
  setSelection: React.Dispatch<React.SetStateAction<Selection>>;
  setTool: React.Dispatch<React.SetStateAction<Tool>>;
  setCameraState: (next: Camera | ((prev: Camera) => Camera)) => void;
  scheduleCameraCommit: (delayMs?: number) => void;
  zoomToCentered: (nextScale: number | ((prev: number) => number)) => void;
  activeDocId?: string;
}) {
  const sdk = React.useMemo<DocumentSDK>(
    () => ({
      version: 4,
      react: React,
      cn,
      ui: { exportAtlas, importAtlas, openMermaidImportDialog },
      doc: {
        get: () => doc,
        set: (next) => setDoc(next),
        update: (updater) => setDoc((prev) => updater(prev)),
      },
      selection: {
        get: () => selection,
        set: (next) => setSelection(next),
        clear: () => setSelection({ kind: "none" }),
      },
      tool: {
        get: () => tool,
        set: (next) => setTool(next),
      },
      camera: {
        get: () => camera,
        set: (next) => {
          setCameraState(next);
          scheduleCameraCommit(150);
        },
      },
      viewport: {
        zoomTo: (nextScale) => zoomToCentered(nextScale),
        zoomBy: (delta) => zoomToCentered((prev) => prev + delta),
      },
    }),
    [
      camera,
      doc,
      exportAtlas,
      importAtlas,
      openMermaidImportDialog,
      selection,
      setDoc,
      setSelection,
      setTool,
      setCameraState,
      scheduleCameraCommit,
      tool,
      zoomToCentered,
    ],
  );

  const scheduleCameraCommitRef = React.useRef(scheduleCameraCommit);
  const sdkRef = React.useRef(sdk);
  React.useEffect(() => {
    sdkRef.current = sdk;
  }, [sdk]);
  React.useEffect(() => {
    scheduleCameraCommitRef.current = scheduleCameraCommit;
  }, [scheduleCameraCommit]);

  const gestureRegisters = React.useMemo<Array<GestureRegister>>(() => builtinGestureRegisters(), []);

  React.useEffect(() => {
    const unsubscribe = subscribeGestureFrame((frame) => {
      const ctx = {
        sdk: sdkRef.current,
        scheduleCameraCommit: scheduleCameraCommitRef.current,
      };
      for (const register of gestureRegisters) {
        register.onFrame(frame, ctx);
      }
    });

    return () => {
      unsubscribe();
      const ctx = {
        sdk: sdkRef.current,
        scheduleCameraCommit: scheduleCameraCommitRef.current,
      };
      for (const register of gestureRegisters) {
        register.onReset?.(ctx);
      }
    };
  }, [gestureRegisters]);

  React.useEffect(() => {
    const ctx = {
      sdk: sdkRef.current,
      scheduleCameraCommit: scheduleCameraCommitRef.current,
    };
    for (const register of gestureRegisters) {
      register.onReset?.(ctx);
    }
  }, [activeDocId, gestureRegisters]);

  const emptyPluginHost = React.useMemo<PluginHost>(() => createEmptyPluginHost(), []);
  const [pluginHost, setPluginHost] = React.useState<PluginHost>(emptyPluginHost);
  React.useLayoutEffect(() => {
    setPluginHost(createPluginHost([BuiltinPlugin], { sdk }));
  }, [sdk]);

  return {
    sdk,
    pluginHost,
  };
}