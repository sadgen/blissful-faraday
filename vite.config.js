import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createApiHandler } from './server/api-handler.js';

export default defineConfig(({ mode }) => {
  // Picks up VITE_ALLOWED_HOSTS from .env / .env.local or the real environment
  const env = loadEnv(mode, process.cwd(), '');
  const extraAllowedHosts = (env.VITE_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);

  return {
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
  };
});
