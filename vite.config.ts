import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const path = (file: string) => fileURLToPath(new URL(file, import.meta.url));

// The workbench in apps/preview serves the app; `@/` imports reach the skin in src/.
export default defineConfig({
  root: path('./apps/preview'),
  // Relative URLs, so the build works at a domain root or in a subfolder such as GitHub Pages.
  base: './',
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@preview': path('./apps/preview/src'),
      '@': path('./src'),
    },
  },
  server: {
    fs: { allow: [path('.')] },
  },
  build: {
    // light-dark() must reach the browser untouched: the kitchen flips color-scheme from JS
    // (the light switch), which the minifier's lowered fallback for older browsers can't follow.
    // These are the first versions with native light-dark() support.
    cssTarget: ['chrome123', 'edge123', 'firefox120', 'safari17.5'],
    outDir: path('./dist'),
    emptyOutDir: true,
    rolldownOptions: {
      // The workbench shell, and the preview page it frames.
      input: { kitchen: path('./apps/preview/index.html'), workbench: path('./apps/preview/workbench.html'), preview: path('./apps/preview/preview.html') },
    },
  },
});
