import * as React from "react";
import { FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";
import { cn } from "@/lib/utils";

const WASM_BASE_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm";
const MODEL_PATH = "/tasks/gesture_recognizer.task";
const MODEL_DB_NAME = "atlas.media";
const MODEL_STORE_NAME = "models";
const MODEL_KEY = "gesture_recognizer.task";

const openModelDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const request = indexedDB.open(MODEL_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MODEL_STORE_NAME)) {
        db.createObjectStore(MODEL_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });

type CachedModelEntry = {
  blob: Blob;
  updatedAt: number;
};

const getCachedModel = async (): Promise<Blob | null> => {
  const db = await openModelDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MODEL_STORE_NAME, "readonly");
    const store = tx.objectStore(MODEL_STORE_NAME);
    const request = store.get(MODEL_KEY);
    request.onsuccess = () => {
      const result = request.result as CachedModelEntry | ArrayBuffer | Blob | undefined;
      if (!result) {
        resolve(null);
        return;
      }
      if (result instanceof Blob) {
        resolve(result);
        return;
      }
      if (result instanceof ArrayBuffer) {
        resolve(new Blob([result], { type: "application/octet-stream" }));
        return;
      }
      if (result && "blob" in result && result.blob instanceof Blob) {
        resolve(result.blob);
        return;
      }
      resolve(null);
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB get failed"));
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  });
};

const cacheModel = async (blob: Blob) => {
  const db = await openModelDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(MODEL_STORE_NAME, "readwrite");
    const store = tx.objectStore(MODEL_STORE_NAME);
    const entry: CachedModelEntry = { blob, updatedAt: Date.now() };
    const request = store.put(entry, MODEL_KEY);
    request.onsuccess = () => undefined;
    request.onerror = () => reject(request.error ?? new Error("IndexedDB put failed"));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
    };
  });
};

const resolveModelAssetPath = async (): Promise<string> => {
  try {
    const cached = await getCachedModel();
    if (cached) {
      return URL.createObjectURL(cached);
    }
    const response = await fetch(MODEL_PATH);
    if (!response.ok) {
      throw new Error(`Model fetch failed: ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    const blob = new Blob([buffer], { type: "application/octet-stream" });
    await cacheModel(blob);
    return URL.createObjectURL(blob);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("Model cache failed, using direct path", error);
    }
    return MODEL_PATH;
  }
};

type PermissionState = "granted" | "denied" | "prompt" | "unknown";
type Landmark = { x: number; y: number };
type DrawParams = {
  scale: number;
  offsetX: number;
  offsetY: number;
  videoWidth: number;
  videoHeight: number;
};

type LandmarkFilter = {
  x: Kalman1D;
  y: Kalman1D;
};

type HandSlot = {
  label: "Left" | "Right" | "Unknown";
  filters: LandmarkFilter[];
  lastCenter: Landmark | null;
  lastSeenAt: number | null;
};

class Kalman1D {
  private x = 0;
  private v = 0;
  private p00 = 1;
  private p01 = 0;
  private p10 = 0;
  private p11 = 1;
  private initialized = false;
  private processNoise: number;
  private measurementNoise: number;

  constructor(processNoise = 1e-3, measurementNoise = 1e-2) {
    this.processNoise = processNoise;
    this.measurementNoise = measurementNoise;
  }

  update(measurement: number, dt: number, predictAhead = 0) {
    if (!this.initialized) {
      this.x = measurement;
      this.v = 0;
      this.p00 = 1;
      this.p01 = 0;
      this.p10 = 0;
      this.p11 = 1;
      this.initialized = true;
    }

    const dt2 = dt * dt;
    const q = this.processNoise;

    const xPred = this.x + this.v * dt;
    const vPred = this.v;

    const p00 = this.p00 + dt * (this.p10 + this.p01) + dt2 * this.p11 + q * dt2;
    const p01 = this.p01 + dt * this.p11;
    const p10 = this.p10 + dt * this.p11;
    const p11 = this.p11 + q * dt;

    const r = this.measurementNoise;
    const s = p00 + r;
    const k0 = p00 / s;
    const k1 = p10 / s;
    const y = measurement - xPred;

    this.x = xPred + k0 * y;
    this.v = vPred + k1 * y;

    this.p00 = (1 - k0) * p00;
    this.p01 = (1 - k0) * p01;
    this.p10 = p10 - k1 * p00;
    this.p11 = p11 - k1 * p01;

    if (predictAhead > 0) {
      return this.x + this.v * predictAhead;
    }
    return this.x;
  }
}

type HandLandmarkerOverlayProps = {
  enabled: boolean;
  mirrored: boolean;
  className?: string;
  onPermissionChange?: (state: PermissionState) => void;
  onRequestDisable?: () => void;
};

export function HandLandmarkerOverlay({
  enabled,
  mirrored,
  className,
  onPermissionChange,
  onRequestDisable,
}: HandLandmarkerOverlayProps) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const recognizerRef = React.useRef<GestureRecognizer | null>(null);
  const recognizerPromiseRef = React.useRef<Promise<GestureRecognizer> | null>(null);
  const modelUrlRef = React.useRef<string | null>(null);
  const landmarkFiltersRef = React.useRef<HandSlot[]>([
    { label: "Unknown", filters: [], lastCenter: null, lastSeenAt: null },
    { label: "Unknown", filters: [], lastCenter: null, lastSeenAt: null },
  ]);
  const lastFrameTimeRef = React.useRef<number | null>(null);

  const stopLoop = React.useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const stopStream = React.useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const revokeModelUrl = React.useCallback(() => {
    if (modelUrlRef.current && modelUrlRef.current.startsWith("blob:")) {
      URL.revokeObjectURL(modelUrlRef.current);
      modelUrlRef.current = null;
    }
  }, []);

  const clearCanvas = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const ensureRecognizer = React.useCallback(async () => {
    if (recognizerRef.current) return recognizerRef.current;
    if (!recognizerPromiseRef.current) {
      recognizerPromiseRef.current = (async () => {
        const vision = await FilesetResolver.forVisionTasks(WASM_BASE_PATH);
        if (!modelUrlRef.current) {
          modelUrlRef.current = await resolveModelAssetPath();
        }
        const modelAssetPath = modelUrlRef.current;
        try {
          const recognizer = await GestureRecognizer.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath,
              delegate: "GPU",
            },
            runningMode: "VIDEO",
            numHands: 2,
            minHandDetectionConfidence: 0.2,
            minHandPresenceConfidence: 0.2,
            minTrackingConfidence: 0.2,
          });
          recognizerRef.current = recognizer;
          return recognizer;
        } catch (error) {
          const recognizer = await GestureRecognizer.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath,
              delegate: "CPU",
            },
            runningMode: "VIDEO",
            numHands: 2,
            minHandDetectionConfidence: 0.2,
            minHandPresenceConfidence: 0.2,
            minTrackingConfidence: 0.2,
          });
          recognizerRef.current = recognizer;
          if (import.meta.env.DEV) {
            console.warn("Falling back to CPU delegate", error);
          }
          return recognizer;
        }
      })();
    }
    return recognizerPromiseRef.current;
  }, []);

  const drawLandmarks = React.useCallback(
    (ctx: CanvasRenderingContext2D, landmarks: Landmark[][], params: DrawParams) => {
      const { scale, offsetX, offsetY, videoWidth, videoHeight } = params;
      ctx.fillStyle = "rgba(56, 189, 248, 0.9)";
      ctx.strokeStyle = "rgba(56, 189, 248, 0.6)";
      ctx.lineWidth = 2;
      landmarks.forEach((hand) => {
        hand.forEach((point) => {
          const px = point.x * videoWidth * scale + offsetX;
          const py = point.y * videoHeight * scale + offsetY;
          ctx.beginPath();
          ctx.arc(px, py, 4, 0, Math.PI * 2);
          ctx.fill();
        });
      });
    },
    [],
  );

  React.useEffect(() => {
    if (!enabled) {
      stopLoop();
      stopStream();
      clearCanvas();
      landmarkFiltersRef.current = [
        { label: "Unknown", filters: [], lastCenter: null, lastSeenAt: null },
        { label: "Unknown", filters: [], lastCenter: null, lastSeenAt: null },
      ];
      lastFrameTimeRef.current = null;
      return;
    }

    let cancelled = false;

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          onPermissionChange?.("denied");
          onRequestDisable?.();
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        onPermissionChange?.("granted");

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        void ensureRecognizer().catch((error) => {
          if (import.meta.env.DEV) {
            console.warn("Gesture recognizer init failed", error);
          }
        });

        const loop = () => {
          const activeVideo = videoRef.current;
          const canvas = canvasRef.current;
          if (!activeVideo || !canvas) return;

          const targetWidth = canvas.clientWidth || 0;
          const targetHeight = canvas.clientHeight || 0;
          const dpr = window.devicePixelRatio || 1;
          if (
            targetWidth &&
            targetHeight &&
            (canvas.width !== Math.round(targetWidth * dpr) ||
              canvas.height !== Math.round(targetHeight * dpr))
          ) {
            canvas.width = Math.round(targetWidth * dpr);
            canvas.height = Math.round(targetHeight * dpr);
          }

          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, targetWidth, targetHeight);

          if (activeVideo.readyState >= 2) {
            const now = performance.now();
            const last = lastFrameTimeRef.current;
            const dt = last ? Math.min(0.1, Math.max(0.001, (now - last) / 1000)) : 1 / 60;
            lastFrameTimeRef.current = now;
            const videoWidth = activeVideo.videoWidth;
            const videoHeight = activeVideo.videoHeight;
            const scale = Math.max(targetWidth / videoWidth, targetHeight / videoHeight);
            const drawWidth = videoWidth * scale;
            const drawHeight = videoHeight * scale;
            const offsetX = (targetWidth - drawWidth) / 2;
            const offsetY = (targetHeight - drawHeight) / 2;

            ctx.imageSmoothingEnabled = true;
            ctx.filter = "none";
            ctx.filter = "blur(12px)";
            ctx.drawImage(activeVideo, offsetX, offsetY, drawWidth, drawHeight);
            ctx.filter = "none";
            ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
            ctx.fillRect(0, 0, targetWidth, targetHeight);

            const recognizer = recognizerRef.current;
            if (recognizer) {
              try {
                const result = recognizer.recognizeForVideo(activeVideo, now);
                if (result.landmarks?.length) {
                  const slots = landmarkFiltersRef.current;
                  const lead = Math.min(0.08, dt * 1.5);
                  const centers = result.landmarks.map((hand) => {
                    const wrist = hand[0] ?? { x: 0, y: 0 };
                    return { x: wrist.x, y: wrist.y } as Landmark;
                  });
                  const labels = result.landmarks.map((_, handIndex) => {
                    const top = result.handednesses?.[handIndex]?.[0];
                    const name = top?.categoryName;
                    const score = typeof top?.score === "number" ? top.score : 0;
                    if ((name === "Left" || name === "Right") && score >= 0.8) return name;
                    return "Unknown";
                  });

                  const slotAssignments = new Map<number, number>();
                  const usedSlots = new Set<number>();

                  const maxJump = 0.25;
                  const slotStaleMs = 450;
                  const slotExpireMs = 700;
                  const computeCost = (
                    center: Landmark,
                    label: HandSlot["label"],
                    slot: HandSlot,
                    nowMs: number,
                  ) => {
                    if (slot.label !== "Unknown" && label !== "Unknown" && slot.label !== label) {
                      return Number.POSITIVE_INFINITY;
                    }
                    const last = slot.lastCenter;
                    const ageMs = slot.lastSeenAt ? nowMs - slot.lastSeenAt : Infinity;
                    const dx = last ? center.x - last.x : 0;
                    const dy = last ? center.y - last.y : 0;
                    const dist = last ? Math.hypot(dx, dy) : 0.2;
                    if (last && dist > maxJump && ageMs < slotStaleMs) {
                      return Number.POSITIVE_INFINITY;
                    }
                    const labelPenalty =
                      slot.label !== "Unknown" && label !== "Unknown" && slot.label === label
                        ? 0
                        : 0.15;
                    const agePenalty = Number.isFinite(ageMs)
                      ? Math.min(0.3, (ageMs / 1000) * 0.3)
                      : 0;
                    return dist + labelPenalty + agePenalty;
                  };

                  if (centers.length >= 2 && slots.length >= 2) {
                    // Solve 2x2 assignment to prevent slot swapping when both hands are present.
                    const c00 = computeCost(centers[0], labels[0], slots[0], now);
                    const c01 = computeCost(centers[0], labels[0], slots[1], now);
                    const c10 = computeCost(centers[1], labels[1], slots[0], now);
                    const c11 = computeCost(centers[1], labels[1], slots[1], now);
                    const aValid = Number.isFinite(c00) && Number.isFinite(c11);
                    const bValid = Number.isFinite(c01) && Number.isFinite(c10);
                    if (aValid || bValid) {
                      const pickA = aValid && (!bValid || c00 + c11 <= c01 + c10);
                      if (pickA) {
                        slotAssignments.set(0, 0);
                        slotAssignments.set(1, 1);
                        usedSlots.add(0);
                        usedSlots.add(1);
                      } else {
                        slotAssignments.set(0, 1);
                        slotAssignments.set(1, 0);
                        usedSlots.add(0);
                        usedSlots.add(1);
                      }
                    }
                  }

                  centers.forEach((center, handIndex) => {
                    if (slotAssignments.has(handIndex)) return;
                    const label = labels[handIndex];
                    let bestSlot = -1;
                    let bestScore = Number.POSITIVE_INFINITY;
                    slots.forEach((slot, slotIndex) => {
                      if (usedSlots.has(slotIndex)) return;
                      const score = computeCost(center, label, slot, now);
                      if (score < bestScore) {
                        bestScore = score;
                        bestSlot = slotIndex;
                      }
                    });
                    if (bestSlot >= 0) {
                      slotAssignments.set(handIndex, bestSlot);
                      usedSlots.add(bestSlot);
                    }
                  });

                  const filtered: Landmark[][] = [];
                  result.landmarks.forEach((hand, handIndex) => {
                    const slotIndex = slotAssignments.get(handIndex);
                    if (slotIndex === undefined) return;
                    const slot = slots[slotIndex];
                    if (labels[handIndex] !== "Unknown") {
                      slot.label = labels[handIndex];
                    }
                    slot.lastCenter = centers[handIndex];
                    slot.lastSeenAt = now;
                    const filteredHand = hand.map((point, pointIndex) => {
                      if (!slot.filters[pointIndex]) {
                        slot.filters[pointIndex] = {
                          x: new Kalman1D(8e-2, 2e-3),
                          y: new Kalman1D(8e-2, 2e-3),
                        };
                      }
                      const filter = slot.filters[pointIndex];
                      return {
                        x: filter.x.update(point.x, dt, lead),
                        y: filter.y.update(point.y, dt, lead),
                      } as Landmark;
                    });
                    filtered.push(filteredHand);
                  });

                  slots.forEach((slot, slotIndex) => {
                    if (usedSlots.has(slotIndex)) return;
                    if (slot.lastSeenAt && now - slot.lastSeenAt > slotExpireMs) {
                      slot.label = "Unknown";
                      slot.lastCenter = null;
                      slot.lastSeenAt = null;
                      slot.filters = [];
                    }
                  });

                  ctx.filter = "none";
                  drawLandmarks(ctx, filtered as Landmark[][], {
                    scale,
                    offsetX,
                    offsetY,
                    videoWidth,
                    videoHeight,
                  });
                }
              } catch (error) {
                if (import.meta.env.DEV) {
                  console.warn("Gesture recognizer detect failed", error);
                }
              }
            }
          }

          rafRef.current = requestAnimationFrame(loop);
        };

        rafRef.current = requestAnimationFrame(loop);
      } catch (error) {
        onPermissionChange?.("denied");
        onRequestDisable?.();
        stopStream();
        clearCanvas();
        if (import.meta.env.DEV) {
          console.warn("Camera start failed", error);
        }
      }
    };

    start();

    return () => {
      cancelled = true;
      stopLoop();
      stopStream();
      clearCanvas();
      revokeModelUrl();
    };
  }, [
    clearCanvas,
    drawLandmarks,
    enabled,
    ensureRecognizer,
    onPermissionChange,
    onRequestDisable,
    revokeModelUrl,
    stopLoop,
    stopStream,
  ]);

  return (
    <div className={cn("absolute inset-0 pointer-events-none", className)}>
      <div
        className="absolute inset-0"
        style={{
          transform: mirrored ? "scaleX(-1)" : "none",
          transformOrigin: "center",
        }}
      >
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover opacity-0"
          playsInline
          muted
        />
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      </div>
    </div>
  );
}
