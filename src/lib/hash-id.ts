let sequence = 0;

function nextSequenceHex() {
  sequence = (sequence + 1) >>> 0;
  return sequence.toString(16).padStart(8, "0");
}

function randomHex(byteLength: number) {
  const values = new Uint8Array(byteLength);
  if (typeof globalThis.crypto !== "undefined" && "getRandomValues" in globalThis.crypto) {
    globalThis.crypto.getRandomValues(values);
  } else {
    for (let index = 0; index < values.length; index += 1) {
      values[index] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

function hashFragment(value: string, seed: number) {
  let hash = (0x811c9dc5 ^ seed) >>> 0;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}

function buildHash(value: string) {
  return hashFragment(value, 0x9e3779b9);
}

export function createHashId(prefix: string, seed = "") {
  const performanceNow =
    typeof globalThis.performance !== "undefined" ? globalThis.performance.now() : 0;
  const entropy = [
    prefix,
    seed,
    Date.now().toString(16).padStart(12, "0"),
    Math.floor(performanceNow * 1000)
      .toString(16)
      .padStart(12, "0"),
    nextSequenceHex(),
    randomHex(16),
  ].join(":");

  return `${prefix}_${buildHash(entropy)}`;
}

export function createUniqueHashId(prefix: string, existing: Set<string>, seed = "") {
  let attempt = 0;
  let id = createHashId(prefix, seed);

  while (existing.has(id)) {
    attempt += 1;
    id = createHashId(prefix, `${seed}:${attempt}`);
  }

  existing.add(id);
  return id;
}
