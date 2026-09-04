import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createApiHandler } from './server/api-handler.js';

// Reverse-proxy domains come from the environment (comma-separated), never hardcoded:
//   VITE_ALLOWED_HOSTS=gallery.example.com,gallery.example.com:8443
const extraAllowedHosts = (process.env.VITE_ALLOWED_HOSTS || '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'vite-image-scanner-api',
      configureServer(server) {
        server.middlewares.use(createApiHandler());
      },
      configurePreviewServer(server) {
        server.middlewares.use(createApiHandler());
      }
    }
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
    open: true,
    allowedHosts: ['localhost', '.local', ...extraAllowedHosts],
    hmr: false,
    watch: {
      ignored: [
        '**/.scan-directory.json',
        '**/.auth-config.json',
        '**/.collection-cache.json',
        '**/resources/**',
        '**/instagram-scraped/**',
        '**/.mimosa/**',
        '**/.git/**',
        '**/*.jpg',
        '**/*.jpeg',
        '**/*.png',
        '**/*.webp',
        '**/*.mp4',
        '**/*.webm',
        '**/*.gif'
      ]
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    open: true,
    allowedHosts: true
  }
});
