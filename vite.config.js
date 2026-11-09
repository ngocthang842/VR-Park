import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function sceneSaver() {
  return {
    name: 'scene-saver',
    configureServer(server) {
      server.middlewares.use('/api/scene', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method !== 'POST') { res.statusCode = 405; return res.end('{}'); }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const { id, config } = JSON.parse(body);
            if (!id || path.basename(id) !== id) throw new Error('id không hợp lệ');
            const dir = path.resolve('public/scenes', id);
            if (!fs.existsSync(dir)) throw new Error('không có thư mục cảnh');
            fs.writeFileSync(path.join(dir, 'scene.json'), JSON.stringify(config, null, 2));
            execSync('node scripts/build-index.mjs');
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), sceneSaver()],
  server: { watch: { ignored: ['**/public/scenes/**'] } },
});