import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Emits sw.js with a fresh cache version and the files needed to start offline.
// Lazily loaded Mermaid chunks are cached the first time a diagram renders.
function serviceWorker(): Plugin {
  return {
    name: "plainpath-sw",
    apply: "build",
    generateBundle(_options, bundle) {
      // The app entry plus everything a flowchart render needs, with their static imports.
      const files = new Set<string>();
      const add = (name: string) => {
        const file = bundle[name];
        if (!file || files.has(name)) return;
        files.add(name);
        if (file.type === "chunk") {
          file.imports.forEach(add);
          file.viteMetadata?.importedCss.forEach(add);
          file.viteMetadata?.importedAssets.forEach(add);
        }
      };
      for (const file of Object.values(bundle)) {
        const needed =
          file.type === "chunk"
            ? file.isEntry || /^(mermaid\.core|flowDiagram|dagre)/.test(file.name)
            : /\.(css|woff2)$/.test(file.fileName);
        if (needed) add(file.fileName);
      }
      const entry = [...files];
      const precache = [
        "./",
        "manifest.webmanifest",
        "favicon.svg",
        "icon-192.png",
        "icon-512.png",
        ...entry,
      ];
      const source = readFileSync("src/sw.js", "utf8")
        .replace("__VERSION__", Date.now().toString(36))
        .replace("__PRECACHE__", JSON.stringify(precache));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

// Relative base so the static build works from any folder (GitHub Pages serves /docs).
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), serviceWorker()],
  build: { outDir: "docs", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
