import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createApiHandler } from './server/api-handler.js';

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
    allowedHosts: ['gallery.example.com', 'localhost', '.example.com', '.local'],
    hmr: false
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    open: true,
    allowedHosts: true
  }
});
