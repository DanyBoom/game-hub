import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: '.',
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist-server/web',
    emptyOutDir: false,
    rollupOptions: { input: 'web/index.html' },
  },
  resolve: { alias: {} },
});
