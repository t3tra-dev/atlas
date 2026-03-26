import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Client-side SPA build output
    outDir: "dist",
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      // Multiple entry points: HTML for client, TS for server
      input: {
        main: path.resolve(__dirname, "index.html"),
        server: path.resolve(__dirname, "src/server/index.ts"),
      },
      // Separate outputs for client SPA and server
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "server") {
            return "server/[name].js";
          }
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@mediapipe/tasks-vision")) return "mediapipe";
          if (id.includes("three/examples/")) return "three-examples";
          if (id.includes("/node_modules/three/")) return "three-core";
          if (id.includes("@radix-ui") || id.includes("lucide-react")) return "ui-vendor";
          if (id.includes("react") || id.includes("scheduler")) return "react-vendor";
          return undefined;
        },
      },
      // Treat Hono and Node dependencies as external (don't bundle them)
      external: ["hono", "hono/cloudflare-workers"],
    },
  },
});
