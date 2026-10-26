import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves the site from /<repo>/; the deploy workflow sets BASE_PATH.
const base = process.env.BASE_PATH || '/'

export default defineConfig({
  base,
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'IPSC Rulebooks Finder',
        short_name: 'IPSC Rules',
        description: 'Search the official IPSC Handgun, Shotgun, Rifle and PCC rulebooks.',
        theme_color: '#111111',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell + rule index are precached; big files are cached the first time they are used.
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2}', 'data/*'],
        globIgnores: ['ort/**', 'models/**', 'pdf/**'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/(models|ort|pdf)\//,
            handler: 'CacheFirst',
            options: { cacheName: 'ipsc-large-files', rangeRequests: true },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
})
