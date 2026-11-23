import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// En desarrollo, /api va al backend de Spring Boot (puerto 8080 por defecto).
const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:8080';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    strictPort: true,
    // Contra una API remota (p. ej. la demo con precios reales) el Host tiene que ser el suyo.
    proxy: { '/api': { target: apiUrl, changeOrigin: apiUrl.startsWith('https://') } },
  },
  test: { include: ['src/**/*.test.ts'] },
});
