/* eslint-disable react-refresh/only-export-components */
import * as React from "react";

import type { DocumentModel } from "@/components/document/model";
import { STORAGE_KEY } from "@/components/document/model";
import { createDefaultDocument } from "@/components/document/default-doc";

export type StoredDoc = {
  id: string;
  title: string;
  doc: DocumentModel;
  createdAt: number;
  updatedAt: number;
};

type DocumentStoreState = {
  version: 1;
  activeId: string;
  docs: StoredDoc[];
};

type DocumentStoreContextValue = {
  docs: StoredDoc[];
  activeId: string;
  activeDoc: StoredDoc | null;
  setActiveId: (id: string) => void;
  createDoc: (title?: string) => void;
  renameDoc: (id: string, title: string) => void;
  deleteDoc: (id: string) => void;
  setActiveDoc: (next: DocumentModel | ((prev: DocumentModel) => DocumentModel)) => void;
};

const DocumentStoreContext = React.createContext<DocumentStoreContextValue | null>(null);

function newId(prefix: string) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
  return `${prefix}_${String(random).replaceAll("-", "")}`;
}

function loadStore(): DocumentStoreState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DocumentStoreState;
      if (parsed && parsed.version === 1 && parsed.docs?.length) {
        const ensureTitle = (value: unknown, fallback: string) => {
          if (typeof value === "string") {
            const trimmed = value.trim();
            return trimmed ? trimmed : fallback;
          }
          if (typeof value === "number") return String(value);
          return fallback;
        };

        const docs = parsed.docs
          .map((doc, index) => {
            if (!doc?.doc) return null;
            const fallback = `ドキュメント ${index + 1}`;
            const title = ensureTitle(doc.title ?? doc.doc?.title, fallback);
            return {
              ...doc,
              title,
              doc: { ...doc.doc, title },
            } as StoredDoc;
          })
          .filter((doc): doc is StoredDoc => Boolean(doc));

        if (docs.length) {
          const activeId = docs.some((doc) => doc.id === parsed.activeId)
            ? parsed.activeId
            : docs[0].id;
          return { ...parsed, activeId, docs };
        }
      }
    }
  } catch {
    // ignore
  }

  const firstId = newId("doc");
  const firstDoc = createDefaultDocument("ドキュメント 1");
  return {
    version: 1,
    activeId: firstId,
    docs: [
      {
        id: firstId,
        title: firstDoc.title,
        doc: firstDoc,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
  };
}

export function DocumentStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<DocumentStoreState>(() => loadStore());

  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
  }, [state]);

  const setActiveId = React.useCallback((id: string) => {
    setState((prev) => ({ ...prev, activeId: id }));
  }, []);

  const createDoc = React.useCallback((title?: string) => {
    setState((prev) => {
      const nextIndex = prev.docs.length + 1;
      const docTitle = title?.trim() ? title.trim() : `ドキュメント ${nextIndex}`;
      const id = newId("doc");
      const doc = createDefaultDocument(docTitle);
      const next: StoredDoc = {
        id,
        title: docTitle,
        doc,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      return {
        ...prev,
        activeId: id,
        docs: [next, ...prev.docs],
      };
    });
  }, []);

  const renameDoc = React.useCallback((id: string, title: string) => {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    setState((prev) => {
      const index = prev.docs.findIndex((d) => d.id === id);
      if (index < 0) return prev;
      const current = prev.docs[index];
      const updated: StoredDoc = {
        ...current,
        title: nextTitle,
        doc: { ...current.doc, title: nextTitle },
        updatedAt: Date.now(),
      };
      const docs = prev.docs.slice();
      docs[index] = updated;
      return { ...prev, docs };
    });
  }, []);

  const deleteDoc = React.useCallback((id: string) => {
    setState((prev) => {
      const remaining = prev.docs.filter((d) => d.id !== id);
      if (!remaining.length) {
        const nextId = newId("doc");
        const newDoc = createDefaultDocument("ドキュメント 1");
        return {
          ...prev,
          activeId: nextId,
          docs: [
            {
              id: nextId,
              title: newDoc.title,
              doc: newDoc,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
        };
      }

      const nextActive = prev.activeId === id ? remaining[0].id : prev.activeId;
      return {
        ...prev,
        activeId: nextActive,
        docs: remaining,
      };
    });
  }, []);

  const setActiveDoc = React.useCallback(
    (next: DocumentModel | ((prev: DocumentModel) => DocumentModel)) => {
      setState((prev) => {
        const index = prev.docs.findIndex((d) => d.id === prev.activeId);
        if (index < 0) return prev;
        const current = prev.docs[index];
        const nextDoc = typeof next === "function" ? next(current.doc) : next;
        const nextTitle =
          typeof nextDoc.title === "string" && nextDoc.title.trim()
            ? nextDoc.title.trim()
            : current.title;
        const updated: StoredDoc = {
          ...current,
          title: nextTitle,
          doc: { ...nextDoc, title: nextTitle },
          updatedAt: Date.now(),
        };
        const docs = prev.docs.slice();
        docs[index] = updated;
        return { ...prev, docs };
      });
    },
    [],
  );

  const activeDoc = React.useMemo(
    () => state.docs.find((d) => d.id === state.activeId) ?? null,
    [state.activeId, state.docs],
  );

  const value = React.useMemo<DocumentStoreContextValue>(
    () => ({
      docs: state.docs,
      activeId: state.activeId,
      activeDoc,
      setActiveId,
      createDoc,
      renameDoc,
      deleteDoc,
      setActiveDoc,
    }),
    [
      activeDoc,
      createDoc,
      deleteDoc,
      renameDoc,
      setActiveDoc,
      setActiveId,
      state.activeId,
      state.docs,
    ],
  );

  return <DocumentStoreContext.Provider value={value}>{children}</DocumentStoreContext.Provider>;
}

export function useDocumentStore() {
  const ctx = React.useContext(DocumentStoreContext);
  if (!ctx) {
    throw new Error("useDocumentStore must be used within DocumentStoreProvider");
  }
  return ctx;
}
