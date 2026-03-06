import * as React from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import type { EmbeddedBinaryMedia } from "@/components/document/atlas-binary";
import { registerThreeCanvasGestureController } from "@/plugins/builtin/three-canvas-control-bus";

type ThreeCanvasViewProps = {
  nodeId: string;
  model: EmbeddedBinaryMedia | null;
  background: string;
};

function toArrayBufferCopy(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function parseBackgroundColor(input: string): THREE.Color {
  try {
    return new THREE.Color(input);
  } catch {
    return new THREE.Color("#0b1220");
  }
}

function frameObject(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  object: THREE.Object3D,
) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;

  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.1);
  const fov = (camera.fov * Math.PI) / 180;
  const distance = (maxDim / (2 * Math.tan(fov / 2))) * 1.6;

  controls.target.set(0, 0, 0);
  camera.position.set(distance, distance * 0.8, distance);
  camera.near = Math.max(distance / 500, 0.01);
  camera.far = Math.max(distance * 500, 50);
  camera.updateProjectionMatrix();
  controls.update();
}

function centerObjectAtOrigin(object: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  object.position.sub(center);
  object.updateMatrixWorld(true);
}

function disposeObject3D(root: THREE.Object3D) {
  root.traverse((child) => {
    const asMesh = child as THREE.Mesh;
    if (asMesh.geometry) {
      asMesh.geometry.dispose();
    }
    const materialContainer = asMesh as { material?: THREE.Material | Array<THREE.Material> };
    if (Array.isArray(materialContainer.material)) {
      for (const material of materialContainer.material) {
        material.dispose();
      }
    } else if (materialContainer.material) {
      materialContainer.material.dispose();
    }
  });
}

export function ThreeCanvasView({ nodeId, model, background }: ThreeCanvasViewProps) {
  const mountRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(parseBackgroundColor(background), 0.35);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    camera.position.set(2.8, 2.2, 2.8);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.1;
    controls.maxDistance = 100;
    controls.target.set(0, 0, 0);

    const unregisterGestureController = registerThreeCanvasGestureController(nodeId, {
      orbitByScreenDelta: (dxPixels, dyPixels) => {
        const height = Math.max(1, renderer.domElement.clientHeight);
        const azimuth = (2 * Math.PI * dxPixels) / height;
        const polar = (2 * Math.PI * dyPixels) / height;
        controls.rotateLeft(azimuth);
        controls.rotateUp(polar);
        controls.update();
      },
    });

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(4, 6, 3);
    scene.add(dirLight);

    const grid = new THREE.GridHelper(10, 10, 0x3a4257, 0x2a3042);
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const material of gridMaterials) {
      material.transparent = true;
      material.opacity = 0.45;
    }
    scene.add(grid);

    const axes = new THREE.AxesHelper(0.8);
    scene.add(axes);

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      renderer.setSize(width, height, true);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);

    let loadedObject: THREE.Object3D | null = null;
    let modelUrl: string | null = null;
    let isDisposed = false;

    if (model) {
      const blob = new Blob([toArrayBufferCopy(model.bytes)], {
        type: model.mimeType || "model/gltf-binary",
      });
      modelUrl = URL.createObjectURL(blob);

      const loader = new GLTFLoader();
      loader.load(
        modelUrl,
        (gltf) => {
          if (isDisposed) return;
          loadedObject = gltf.scene;
          centerObjectAtOrigin(loadedObject);
          scene.add(loadedObject);
          frameObject(camera, controls, loadedObject);
        },
        undefined,
        () => {
          // ignore loading errors for now
        },
      );
    }

    let rafId = 0;
    const renderLoop = () => {
      controls.update();
      renderer.render(scene, camera);
      rafId = window.requestAnimationFrame(renderLoop);
    };
    renderLoop();

    return () => {
      isDisposed = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      unregisterGestureController();
      controls.dispose();

      if (loadedObject) {
        scene.remove(loadedObject);
        disposeObject3D(loadedObject);
      }

      scene.remove(grid);
      scene.remove(axes);
      scene.remove(ambientLight);
      scene.remove(dirLight);

      renderer.dispose();
      renderer.domElement.remove();

      if (modelUrl) {
        URL.revokeObjectURL(modelUrl);
      }
    };
  }, [background, model, nodeId]);

  return (
    <div
      className="h-full w-full touch-none"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div ref={mountRef} className="h-full w-full" />
    </div>
  );
}
