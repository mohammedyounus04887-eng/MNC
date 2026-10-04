import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";
import { renderMessagingConfig } from "./scripts/messaging-config.mjs";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: true,
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  build: {
    target: ["es2015", "safari14", "ios14"],
    cssTarget: ["safari14", "ios14"],
  },
  plugins: [
    react(),
    {
      name: "club-public-messaging-config",
      configureServer(server) {
        server.middlewares.use("/firebase-messaging-config.js", (_req, res) => {
          res.setHeader("Content-Type", "application/javascript");
          res.setHeader("Cache-Control", "no-store");
          res.end(renderMessagingConfig(loadEnv(mode, process.cwd(), "VITE_")));
        });
      },
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "firebase-messaging-config.js", source: renderMessagingConfig(loadEnv(mode, process.cwd(), "VITE_")) });
      },
    } satisfies Plugin,
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.ico',
        'apple-touch-icon.png',
        'pwa-192x192.png',
        'pwa-512x512.png',
        'manifest-kitchen.json',
        'manifest-reception.json'
      ],
      manifest: {
        name: 'MNC Platform',
        short_name: 'MNC',
        description: 'Magic Nutrition Club Platform',
        theme_color: '#2d9653',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        // Take over from any older SW immediately so users on a stale
        // version don't keep loading old JS chunks (the cause of the
        // intermittent "blank screen / Unable to load profile" reports).
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // ── Precache the shell, not the whole app ────────────────────────
        //
        // This used to be '**/*.{js,css,html,ico,png,svg}', which precached
        // every one of the 263 built chunks — 7.75 MB — the moment anybody
        // opened any page. A member signing in needs about 1.3 MB of that;
        // the rest is the reception screen, the face models, xlsx, jsPDF and
        // the chart library, downloaded on their phone so it could sit unused.
        //
        // Worse, it happened again after every deploy: new content hashes mean
        // new filenames, so the whole 7.75 MB was re-fetched. That download ran
        // in parallel with the login page's own chunks and on a phone it is the
        // login page that lost.
        //
        // Now: the HTML and CSS are precached so the shell paints offline, and
        // the JS is cached as it is actually requested (below). Every screen
        // still works offline once it has been opened — which for the reception
        // and kitchen tablets is every screen they use, every day.
        globPatterns: ['**/*.{css,html,ico,png,svg,webmanifest}'],
        runtimeCaching: [
          {
            // Built chunks carry a content hash in the filename, so a given URL
            // can never change meaning. CacheFirst is safe and never revalidates.
            urlPattern: /\/assets\/.*\.(?:js|css)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'app-assets',
              expiration: {
                maxEntries: 400,
                maxAgeSeconds: 60 * 60 * 24 * 60
              },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // Face-recognition model weights: several MB, fetched only by the
            // screens that actually run detection.
            urlPattern: /\/models\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'face-models',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 90
              },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // Herbalife's official product photography, shown on the loyalty
            // board. That screen is left running on a wall all day, so the
            // pictures are kept locally after the first load: a slow or
            // unreachable CDN mid-service must not empty the gift list.
            urlPattern: /^https:\/\/www\.herbalife\.com\/assets\/.*\.(?:png|jpg|jpeg|webp)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'product-images',
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 180
              },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              }
            }
          },
          {
            urlPattern: /^https:\/\/firebasestorage\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'firebase-storage-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 7
              }
            }
          }
        ]
      }
    })
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
