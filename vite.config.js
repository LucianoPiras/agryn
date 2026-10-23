import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Las llamadas a /api van al servidor de AGRYN (server/index.js).
const api = { '/api': 'http://localhost:3001' };

export default defineConfig({
  plugins: [react()],
  server: { proxy: api },
  preview: { proxy: api }
});
