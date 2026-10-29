import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Read-only local fixture server. This is deliberately separate from node --test.
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PSYCHE_SMOKE_PORT || 8137);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const server = http.createServer(async (request, response) => {
    try {
        const pathname = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname);
        const target = path.resolve(project, `.${pathname === '/' ? '/tests/browser-smoke.html' : pathname}`);
        if (!target.startsWith(project + path.sep)) throw new Error('Path outside fixture');
        const bytes = await readFile(target);
        response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(bytes);
    } catch {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found');
    }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`PsycheEngine browser fixture: http://127.0.0.1:${port}/tests/browser-smoke.html\n`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
