/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// BASE_PATH is set to "/PocketRehab/" by the GitHub Pages workflow; "/" everywhere else.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'PocketRehab — Rehab done right.',
        short_name: 'PocketRehab',
        description:
          'Follow your clinician-approved rehab plan with on-device movement tracking, confidence-aware coaching, and shareable progress reports.',
        theme_color: '#0f3d3e',
        background_color: '#f6f3ee',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        categories: ['health', 'medical', 'fitness'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        navigateFallback: 'index.html',
        // The pose model + WebAssembly runtime are large, so they are cached the
        // first time a camera session loads them instead of being precached.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/mediapipe/') || url.pathname.includes('/models/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'pocketrehab-pose-model',
              expiration: { maxEntries: 10 },
              cacheableResponse: { statuses: [200] },
            },
          },
          // Coach voice: the clip list can change between releases; the clips themselves never do (content-hashed names).
          {
            urlPattern: ({ url }) => url.pathname.endsWith('/voice/manifest.json'),
            handler: 'NetworkFirst',
            options: { cacheName: 'pocketrehab-voice-manifest', cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes('/voice/') && url.pathname.endsWith('.mp3'),
            handler: 'CacheFirst',
            options: { cacheName: 'pocketrehab-voice', expiration: { maxEntries: 400 }, cacheableResponse: { statuses: [200] } },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
    css: false,
  },
});
