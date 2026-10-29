import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function walk(folder) {
    const files = [];
    for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const path = resolve(folder, entry.name);
        files.push(...(entry.isDirectory() ? await walk(path) : [path]));
    }
    return files;
}
const files = await walk(root); let scripts = 0;
for (const path of files) {
    if (/\.m?js$/.test(path)) {
        const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
        if (result.status) throw new Error(result.stderr);
        scripts++;
        const source = await readFile(path, 'utf8');
        for (const match of source.matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g)) await readFile(resolve(dirname(path), match[1]));
    }
    if (path.endsWith('.json')) JSON.parse(await readFile(path, 'utf8'));
}
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
for (const key of ['js', 'css']) await readFile(resolve(root, manifest[key]));
console.log(`Validated ${scripts} JavaScript modules, relative imports, JSON and install manifest. No transpilation required.`);
