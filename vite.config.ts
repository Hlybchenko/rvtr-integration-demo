import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import type { Plugin } from 'vite';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
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

/**
 * Pixel Streaming reverse proxy — makes the PS iframe same-origin so the
 * parent can access iframe.contentDocument for keyboard event bridging.
 *
 * 1. Frontend POSTs the PS origin to POST /api/ps-target
 * 2. All /ps-proxy/* HTTP requests are reverse-proxied to that target
 * 3. WebSocket upgrades on /ps-proxy/* are piped via raw TCP
 */
function psProxyPlugin(): Plugin {
  let psTarget: string | null = null;

  return {
    name: 'ps-proxy',
    configureServer(server) {
      // ── POST /api/ps-target — set dynamic proxy target ──────────────
      server.middlewares.use('/api/ps-target', (req, res) => {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (c: Buffer) => (body += c));
          req.on('end', () => {
            try {
              const { url } = JSON.parse(body);
              psTarget = url || null;
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, target: psTarget }));
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
          });
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ target: psTarget }));
      });

      // ── HTTP reverse proxy for /ps-proxy/* ──────────────────────────
      server.middlewares.use('/ps-proxy', (req, res) => {
        if (!psTarget) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No PS target configured' }));
          return;
        }

        let targetUrl: URL;
        try {
          const restPath = (req.url ?? '').replace(/^\/ps-proxy/, '') || '/';
          targetUrl = new URL(restPath, psTarget);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid URL' }));
          return;
        }

        const isSecure = targetUrl.protocol === 'https:';
        const proxyReq = (isSecure ? https : http).request(
          {
            hostname: targetUrl.hostname,
            port: Number(targetUrl.port) || (isSecure ? 443 : 80),
            path: targetUrl.pathname + targetUrl.search,
            method: req.method,
            headers: {
              ...req.headers,
              host: targetUrl.host,
              'accept-encoding': 'identity',
            },
            timeout: 15_000,
          },
          (proxyRes) => {
            // Strip frame-blocking headers so the iframe loads
            delete proxyRes.headers['x-frame-options'];
            delete proxyRes.headers['content-security-policy'];
            res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
            proxyRes.pipe(res);
          },
        );

        proxyReq.on('error', () => {
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
          }
          res.end(JSON.stringify({ error: 'PS server unreachable' }));
        });

        proxyReq.on('timeout', () => {
          proxyReq.destroy();
          if (!res.headersSent) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
          }
          res.end(JSON.stringify({ error: 'PS server timeout' }));
        });

        req.pipe(proxyReq);
      });

      // ── WebSocket upgrade proxy for /ps-proxy/* ─────────────────────
      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (!req.url?.startsWith('/ps-proxy') || !psTarget) return;

        let targetUrl: URL;
        try {
          const restPath = req.url.replace(/^\/ps-proxy/, '') || '/';
          targetUrl = new URL(restPath, psTarget);
        } catch {
          socket.destroy();
          return;
        }

        const isTls = psTarget!.startsWith('https:');
        const port = Number(targetUrl.port) || (isTls ? 443 : 80);
        const onConnect = () => {
          const path = targetUrl.pathname + targetUrl.search;
          const targetOrigin = `${targetUrl.protocol}//${targetUrl.host}`;
          const fwdHeaders = Object.entries(req.headers)
            .filter(([k]) => !['host', 'origin'].includes(k))
            .map(([k, v]) => `${k}: ${v}`)
            .join('\r\n');
          targetSocket.write(
            `GET ${path} HTTP/1.1\r\nHost: ${targetUrl.host}\r\nOrigin: ${targetOrigin}\r\n${fwdHeaders}\r\n\r\n`,
          );
          if (head.length > 0) targetSocket.write(head);
          socket.pipe(targetSocket);
          targetSocket.pipe(socket);
        };
        const targetSocket: net.Socket = isTls
          ? tls.connect({ host: targetUrl.hostname, port, servername: targetUrl.hostname }, onConnect)
          : net.connect({ host: targetUrl.hostname, port }, onConnect);

        targetSocket.on('error', () => socket.destroy());
        socket.on('error', () => targetSocket.destroy());
        socket.on('close', () => targetSocket.destroy());
        targetSocket.on('close', () => socket.destroy());
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), ueApiProxyPlugin(), psProxyPlugin()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
  },
});
