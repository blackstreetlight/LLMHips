import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),

    // ── Whitelist 文件写入插件 ──────────────────────────────────────────────
    // 浏览器无法直接写本地文件；此插件在 Vite dev server 上挂载
    // PUT /whitelist.json  →  将请求体写回 public/whitelist.json
    {
      name: 'whitelist-write',
      configureServer(server) {
        server.middlewares.use('/whitelist.json', (req, res, next) => {
          if (req.method !== 'PUT') { next(); return; }

          const filePath = path.resolve(__dirname, 'public/whitelist.json');
          const chunks: Buffer[] = [];

          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf-8');
            // 简单验证是合法 JSON
            try { JSON.parse(body); } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
              return;
            }
            fs.writeFileSync(filePath, body, 'utf-8');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          });
        });
      },
    },
  ],
})
