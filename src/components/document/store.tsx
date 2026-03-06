/* eslint-disable react-refresh/only-export-components */
import * as React from "react";

import type { DocumentModel } from "@/components/document/model";
import { createDefaultDocument } from "@/components/document/default-doc";
import { createAtlasBlob, decodeAtlasBlob } from "@/components/document/atlas-binary";

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

type PersistedDocRecord = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  blob: Blob;
};

type PersistedMetaRecord = {
  key: string;
  value: string;
};

const DOC_DB_NAME = "atlas.documents";
const DOC_DB_VERSION = 1;
const DOC_STORE_NAME = "docs";
const META_STORE_NAME = "meta";
const ACTIVE_ID_META_KEY = "activeId";

const DocumentStoreContext = React.createContext<DocumentStoreContextValue | null>(null);

function newId(prefix: string) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
  return `${prefix}_${String(random).replaceAll("-", "")}`;
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function openDocumentDB() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }

    const request = indexedDB.open(DOC_DB_NAME, DOC_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOC_STORE_NAME)) {
        db.createObjectStore(DOC_STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META_STORE_NAME)) {
        db.createObjectStore(META_STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function buildInitialState(): DocumentStoreState {
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

function normalizeTitle(value: unknown, fallback: string) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : fallback;
  }
  if (typeof value === "number") return String(value);
  return fallback;
}

async function loadStoreFromIndexedDB(): Promise<DocumentStoreState | null> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDocumentDB();
    const tx = db.transaction([DOC_STORE_NAME, META_STORE_NAME], "readonly");
    const docsReq = tx.objectStore(DOC_STORE_NAME).getAll() as IDBRequest<
      Array<PersistedDocRecord>
    >;
    const activeIdReq = tx.objectStore(META_STORE_NAME).get(ACTIVE_ID_META_KEY) as IDBRequest<
      PersistedMetaRecord | undefined
    >;

    const docsPromise = requestToPromise(docsReq);
    const activePromise = requestToPromise(activeIdReq);
    await transactionDone(tx);

    const rawDocs = await docsPromise;
    const activeRecord = await activePromise;

    const docs: StoredDoc[] = [];
    for (const raw of rawDocs) {
      if (!raw?.id || !(raw.blob instanceof Blob)) continue;
      try {
        const doc = await decodeAtlasBlob(raw.blob);
        const fallbackTitle = doc.title?.trim() || "ドキュメント";
        const title = normalizeTitle(raw.title ?? doc.title, fallbackTitle);
        docs.push({
          id: raw.id,
          title,
          doc: { ...doc, title },
          createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
          updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
        });
      } catch {
        // ignore broken entries
      }
    }

    if (!docs.length) {
      return null;
    }

    docs.sort((a, b) => b.updatedAt - a.updatedAt);

    const activeId = docs.some((d) => d.id === activeRecord?.value)
      ? String(activeRecord?.value)
      : docs[0].id;

    return {
      version: 1,
      activeId,
      docs,
    };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

async function saveStoreToIndexedDB(state: DocumentStoreState): Promise<void> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDocumentDB();
    const tx = db.transaction([DOC_STORE_NAME, META_STORE_NAME], "readwrite");
    const docsStore = tx.objectStore(DOC_STORE_NAME);
    const metaStore = tx.objectStore(META_STORE_NAME);

    await requestToPromise(docsStore.clear());

    for (const stored of state.docs) {
      const blob = createAtlasBlob(stored.doc);
      const record: PersistedDocRecord = {
        id: stored.id,
        title: stored.title,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
        blob,
      };
      await requestToPromise(docsStore.put(record));
    }

    await requestToPromise(
      metaStore.put({
        key: ACTIVE_ID_META_KEY,
        value: state.activeId,
      } satisfies PersistedMetaRecord),
    );

    await transactionDone(tx);
  } finally {
    db?.close();
  }
}

export function DocumentStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<DocumentStoreState>(() => buildInitialState());
  const [hydrated, setHydrated] = React.useState(false);
  const saveQueueRef = React.useRef(Promise.resolve());

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      const loaded = await loadStoreFromIndexedDB();
      if (cancelled) return;
      if (loaded) {
        setState(loaded);
      }
      setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!hydrated) return;

    saveQueueRef.current = saveQueueRef.current
      .then(() => saveStoreToIndexedDB(state))
      .catch(() => {
        // ignore
      });
  }, [hydrated, state]);

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
