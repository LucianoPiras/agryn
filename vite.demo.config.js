// Compila la versión de demostración de AGRYN Monitoreo (una sola página, datos simulados en el navegador).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'demo',
  base: './',
  plugins: [react()],
  build: { outDir: '../dist-demo', emptyOutDir: true, assetsInlineLimit: 100000000, cssCodeSplit: false }
});
