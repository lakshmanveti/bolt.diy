/** Shared Vite + React + Tailwind scaffold used by curated starters. */

export const VITE_REACT_PACKAGE_JSON = `{
  "name": "app",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "lucide-react": "^0.344.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.18",
    "postcss": "^8.4.35",
    "tailwindcss": "^3.4.9",
    "typescript": "^5.5.3",
    "vite": "^5.4.2"
  }
}
`;

export const VITE_CONFIG = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function jsAsJsx() {
  return {
    name: "buildlive-js-as-jsx",
    enforce: "pre",
    async transform(code, id) {
      if (id.includes("node_modules")) return null;
      const file = id.split("?")[0];
      if (!file.endsWith(".js")) return null;
      const { transformWithEsbuild } = await import("vite");
      return transformWithEsbuild(code, file, { loader: "jsx", jsx: "automatic" });
    },
  };
}

export default defineConfig({
  plugins: [jsAsJsx(), react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    watch: {
      usePolling: true,
      interval: 300,
      awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
    },
  },
});
`;

export const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
`;

export const TAILWIND_CONFIG = `/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
`;

export const POSTCSS_CONFIG = `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`;

export const INDEX_HTML = (title: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

export const MAIN_TSX = `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
`;

export const INDEX_CSS = `@tailwind base;
@tailwind components;
@tailwind utilities;

html,
body,
#root {
  min-height: 100%;
}

body {
  margin: 0;
  font-family: Inter, system-ui, sans-serif;
  background: #f8fafc;
  color: #0f172a;
}
`;

export function viteReactFiles(title: string, packageName: string): Record<string, string> {
  return {
    'package.json': VITE_REACT_PACKAGE_JSON.replace('"name": "app"', `"name": "${packageName}"`),
    'vite.config.ts': VITE_CONFIG,
    'tsconfig.json': TSCONFIG,
    'tailwind.config.js': TAILWIND_CONFIG,
    'postcss.config.js': POSTCSS_CONFIG,
    'index.html': INDEX_HTML(title),
    'src/main.tsx': MAIN_TSX,
    'src/index.css': INDEX_CSS,
  };
}
