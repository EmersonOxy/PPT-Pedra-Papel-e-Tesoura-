import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const base = process.env.TRINDADE_BASE_URL || 'http://127.0.0.1:4173';
const modularPath = resolve(fileURLToPath(new URL('../../index.html', import.meta.url)));
const originalPath = resolve(fileURLToPath(new URL('../../Jogar-Trindade-transicao-preta.html', import.meta.url)));
const modular = await readFile(modularPath);
const original = await readFile(originalPath);
const page = await fetch(`${base}/`);
assert.equal(page.status, 200);
assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
assert.equal(Number(page.headers.get('content-length')), modular.byteLength);
const modularText = await page.text();
assert.equal(Buffer.byteLength(modularText, 'utf8'), modular.byteLength);
assert.match(modularText, /type="module"/);
assert.equal(page.headers.get('access-control-allow-origin'), null);

const head = await fetch(`${base}/`, { method: 'HEAD' });
assert.equal(head.status, 200);
assert.equal(Number(head.headers.get('content-length')), modular.byteLength);

const originalPage = await fetch(`${base}/Jogar-Trindade-transicao-preta.html`);
assert.equal(originalPage.status, 200);
assert.deepEqual(Buffer.from(await originalPage.arrayBuffer()), original);

const post = await fetch(`${base}/`, { method: 'POST' });
assert.equal(post.status, 405);
assert.equal(post.headers.get('allow'), 'GET, HEAD');

const traversal = await fetch(`${base}/%2e%2e%2fWindows/win.ini`);
assert.notEqual(traversal.status, 200);
const gitMetadata = await fetch(`${base}/.git/config`);
assert.equal(gitMetadata.status, 404);
const codexConfig = await fetch(`${base}/.codex/config.toml`);
assert.equal(codexConfig.status, 404);

process.stdout.write('Local server smoke: 8 checks passed (modular GET/HEAD, original HTML integrity, write-method rejection, traversal and hidden-config rejection)\n');
