import type { DocNode, DocumentModel } from "@/components/document/model";

export const ATLAS_MAGIC_STRING = "ATLAS";
export const ATLAS_FORMAT_VERSION = 1;
export const ATLAS_MIME_TYPE = "application/x-atlas";
export const ATLAS_FILE_EXTENSION = ".atlas";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAGIC_BYTES = encoder.encode(ATLAS_MAGIC_STRING);

export type EmbeddedBinaryMedia = {
  kind: "embedded";
  mimeType: string;
  bytes: Uint8Array;
};

type SerializedEmbeddedMediaRef = {
  kind: "embedded";
  mimeType: string;
  mediaIndex: number;
};

type PackedMedia = {
  mimeType: string;
  bytes: Uint8Array;
};

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) {
    throw new Error(message);
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value) && value.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    return new Uint8Array(value);
  }
  return null;
}

export function isEmbeddedBinaryMedia(value: unknown): value is EmbeddedBinaryMedia {
  const rec = asObjectRecord(value);
  if (!rec) return false;
  return (
    rec.kind === "embedded" &&
    typeof rec.mimeType === "string" &&
    rec.mimeType.length > 0 &&
    rec.bytes instanceof Uint8Array
  );
}

function normalizeEmbeddedBinaryMedia(value: unknown): EmbeddedBinaryMedia | null {
  const rec = asObjectRecord(value);
  if (!rec || rec.kind !== "embedded" || typeof rec.mimeType !== "string") return null;
  const mimeType = rec.mimeType.trim();
  if (!mimeType) return null;
  const bytes = toUint8Array(rec.bytes);
  if (!bytes) return null;
  return { kind: "embedded", mimeType, bytes };
}

function serializeNode(node: DocNode, media: PackedMedia[]): DocNode {
  if (node.type !== "image") return node;
  const props = asObjectRecord(node.props);
  assert(props, "imageノードのpropsが不正です");
  const normalizedMedia = normalizeEmbeddedBinaryMedia(props.media);
  assert(normalizedMedia, "imageノードのmediaが不正です");

  const mediaIndex = media.length;
  media.push({
    mimeType: normalizedMedia.mimeType,
    bytes: normalizedMedia.bytes,
  });

  const mediaRef: SerializedEmbeddedMediaRef = {
    kind: "embedded",
    mimeType: normalizedMedia.mimeType,
    mediaIndex,
  };

  return {
    ...node,
    props: {
      ...props,
      media: mediaRef,
    },
  };
}

function deserializeNode(node: DocNode, media: PackedMedia[]): DocNode {
  if (node.type !== "image") return node;
  const props = asObjectRecord(node.props);
  assert(props, "imageノードのpropsが不正です");

  const mediaRef = asObjectRecord(props.media);
  assert(mediaRef && mediaRef.kind === "embedded", "imageノードのmedia参照が不正です");
  const mediaIndex = mediaRef.mediaIndex;
  assert(Number.isInteger(mediaIndex), "imageノードのmediaIndexが不正です");
  const packed = media[Number(mediaIndex)];
  assert(packed, "imageノードのmediaIndexが範囲外です");

  return {
    ...node,
    props: {
      ...props,
      media: {
        kind: "embedded",
        mimeType: packed.mimeType,
        bytes: new Uint8Array(packed.bytes),
      } satisfies EmbeddedBinaryMedia,
    },
  };
}

function validateDocumentShape(doc: unknown): asserts doc is DocumentModel {
  const rec = asObjectRecord(doc);
  assert(rec, "ドキュメントがオブジェクトではありません");
  assert(rec.version === 1, "version=1のドキュメントのみ対応しています");
  assert(typeof rec.title === "string", "titleが不正です");

  const camera = asObjectRecord(rec.camera);
  assert(camera, "cameraが不正です");
  assert(
    isFiniteNumber(camera.x) && isFiniteNumber(camera.y) && isFiniteNumber(camera.scale),
    "cameraの値が不正です",
  );

  const canvas = asObjectRecord(rec.canvas);
  assert(canvas, "canvasが不正です");
  assert(
    isFiniteNumber(canvas.width) &&
      isFiniteNumber(canvas.height) &&
      (canvas.background === "grid" || canvas.background === "plain"),
    "canvasの値が不正です",
  );

  assert(asObjectRecord(rec.nodes), "nodesが不正です");
  assert(Array.isArray(rec.nodeOrder), "nodeOrderが不正です");
  assert(asObjectRecord(rec.edges), "edgesが不正です");
  assert(Array.isArray(rec.edgeOrder), "edgeOrderが不正です");
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}

function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function assertWithinBounds(
  totalLength: number,
  offset: number,
  requiredLength: number,
  label: string,
) {
  const next = offset + requiredLength;
  assert(next <= totalLength, `${label}の長さが不正です`);
}

export function encodeAtlasDocument(doc: DocumentModel): Uint8Array {
  const packedMedia: PackedMedia[] = [];
  const serializedNodes: Record<string, DocNode> = {};

  for (const nodeId of Object.keys(doc.nodes)) {
    const node = doc.nodes[nodeId];
    if (!node) continue;
    serializedNodes[nodeId] = serializeNode(node, packedMedia);
  }

  const serializedDoc: DocumentModel = {
    ...doc,
    nodes: serializedNodes,
  };

  const jsonBytes = encoder.encode(JSON.stringify(serializedDoc));
  const headerLength = MAGIC_BYTES.length + 1 + 4 + 4;
  const mimeEntries = packedMedia.map((entry) => ({
    mimeBytes: encoder.encode(entry.mimeType),
    dataBytes: entry.bytes,
  }));

  let totalLength = headerLength + jsonBytes.length;
  for (const entry of mimeEntries) {
    assert(entry.mimeBytes.length <= 0xffff, "mimeTypeが長すぎます");
    totalLength += 2 + entry.mimeBytes.length + 4 + entry.dataBytes.length;
  }

  const output = new Uint8Array(totalLength);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  let offset = 0;

  output.set(MAGIC_BYTES, offset);
  offset += MAGIC_BYTES.length;
  output[offset] = ATLAS_FORMAT_VERSION;
  offset += 1;
  writeUint32(view, offset, jsonBytes.length);
  offset += 4;
  writeUint32(view, offset, mimeEntries.length);
  offset += 4;
  output.set(jsonBytes, offset);
  offset += jsonBytes.length;

  for (const entry of mimeEntries) {
    writeUint16(view, offset, entry.mimeBytes.length);
    offset += 2;
    output.set(entry.mimeBytes, offset);
    offset += entry.mimeBytes.length;
    writeUint32(view, offset, entry.dataBytes.length);
    offset += 4;
    output.set(entry.dataBytes, offset);
    offset += entry.dataBytes.length;
  }

  return output;
}

export function decodeAtlasDocument(input: ArrayBuffer | Uint8Array): DocumentModel {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  assertWithinBounds(bytes.length, offset, MAGIC_BYTES.length + 1 + 4 + 4, "ヘッダ");
  for (let i = 0; i < MAGIC_BYTES.length; i += 1) {
    assert(bytes[offset + i] === MAGIC_BYTES[i], "ATLASマジックストリングが一致しません");
  }
  offset += MAGIC_BYTES.length;

  const formatVersion = bytes[offset];
  offset += 1;
  assert(
    formatVersion === ATLAS_FORMAT_VERSION,
    `未対応のATLASフォーマットです (version=${formatVersion})`,
  );

  const jsonLength = readUint32(view, offset);
  offset += 4;
  const mediaCount = readUint32(view, offset);
  offset += 4;

  assertWithinBounds(bytes.length, offset, jsonLength, "JSONセクション");
  const jsonBytes = bytes.slice(offset, offset + jsonLength);
  offset += jsonLength;

  const packedMedia: PackedMedia[] = [];
  for (let i = 0; i < mediaCount; i += 1) {
    assertWithinBounds(bytes.length, offset, 2, "media mimeType長");
    const mimeLength = readUint16(view, offset);
    offset += 2;

    assertWithinBounds(bytes.length, offset, mimeLength, "media mimeType");
    const mimeType = decoder.decode(bytes.slice(offset, offset + mimeLength)).trim();
    offset += mimeLength;
    assert(mimeType.length > 0, "media mimeTypeが空です");

    assertWithinBounds(bytes.length, offset, 4, "media data長");
    const dataLength = readUint32(view, offset);
    offset += 4;

    assertWithinBounds(bytes.length, offset, dataLength, "media data");
    const data = bytes.slice(offset, offset + dataLength);
    offset += dataLength;

    packedMedia.push({ mimeType, bytes: data });
  }

  assert(offset === bytes.length, "ATLASファイル末尾に不明なデータがあります");

  const parsedUnknown = JSON.parse(decoder.decode(jsonBytes)) as unknown;
  validateDocumentShape(parsedUnknown);
  const parsedDoc = parsedUnknown as DocumentModel;

  const nextNodes: Record<string, DocNode> = {};
  for (const nodeId of Object.keys(parsedDoc.nodes)) {
    const node = parsedDoc.nodes[nodeId];
    if (!node) continue;
    nextNodes[nodeId] = deserializeNode(node, packedMedia);
  }

  return {
    ...parsedDoc,
    nodes: nextNodes,
  };
}

export async function decodeAtlasBlob(blob: Blob): Promise<DocumentModel> {
  const buffer = await blob.arrayBuffer();
  return decodeAtlasDocument(buffer);
}

export function createAtlasBlob(doc: DocumentModel): Blob {
  const bytes = encodeAtlasDocument(doc);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: ATLAS_MIME_TYPE });
}
