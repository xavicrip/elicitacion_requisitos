/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Mismo proxy que Caddy (research R2): /api/* → api, sin el prefijo, y el WebSocket de
    // Socket.IO con el prefijo (feature 005).
    proxy: {
      '/api': {
        target: process.env.API_INTERNAL_URL ?? 'http://localhost:3000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/socket.io': {
        target: process.env.API_INTERNAL_URL ?? 'http://localhost:3000',
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
  },
});
