import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import type { Plugin } from 'vite';
import http from 'node:http';
import { URL } from 'node:url';

/**
 * Custom Vite plugin that proxies /ue-api/* requests to the UE Remote API.
 *
 * The actual UE host is dynamic (user-configured), so we read it from
 * the `X-Ue-Target` request header on every request. This avoids the
 * shared-state problem of `http-proxy` dynamic target reassignment.
 *
 * Frontend: POST /ue-api/ravatar  +  X-Ue-Target: http://127.0.0.1:8081
 *        → proxied to POST http://127.0.0.1:8081/ravatar
 */
function ueApiProxyPlugin(): Plugin {
  return {
    name: 'ue-api-proxy',
    configureServer(server) {
      server.middlewares.use('/ue-api', (req, res) => {
        const targetHeader = req.headers['x-ue-target'];
        if (!targetHeader || typeof targetHeader !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing X-Ue-Target header' }));
          return;
        }

        let targetUrl: URL;
        try {
          // Strip /ue-api prefix, append the rest to target
          const restPath = (req.url ?? '').replace(/^\/ue-api/, '') || '/';
          targetUrl = new URL(restPath, targetHeader);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid X-Ue-Target URL' }));
          return;
        }

        const proxyReq = http.request(
          {
            hostname: targetUrl.hostname,
            port: targetUrl.port,
            path: targetUrl.pathname + targetUrl.search,
            method: req.method,
            headers: Object.fromEntries(
              Object.entries(req.headers)
                .filter(([k]) => k !== 'x-ue-target')
                .concat([['host', targetUrl.host]]),
            ),
            timeout: 5_000,
          },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
            proxyRes.pipe(res);
          },
        );

        proxyReq.on('error', () => {
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
          }
          res.end(JSON.stringify({ error: 'UE API unreachable' }));
        });

        proxyReq.on('timeout', () => {
          proxyReq.destroy();
          if (!res.headersSent) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
          }
          res.end(JSON.stringify({ error: 'UE API timeout' }));
        });

        req.pipe(proxyReq);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), ueApiProxyPlugin()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
  },
});
