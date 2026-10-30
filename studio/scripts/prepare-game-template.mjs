import { copyFile, lstat, mkdir, readdir, realpath, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const studioRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(studioRoot, '..');
const bundleRoot = resolve(studioRoot, '.bundle');
const templateRoot = resolve(bundleRoot, 'game-template');
if (!templateRoot.startsWith(bundleRoot + sep)) throw new Error('Destino do modelo fora da pasta permitida.');
const require = createRequire(import.meta.url);
const { allowedFiles } = require('../electron/project-service.cjs');

const existing = await lstat(bundleRoot).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
if (existing && (existing.isSymbolicLink() || !existing.isDirectory())) throw new Error('A pasta .bundle não é válida.');
await mkdir(bundleRoot, { recursive: true });
await rm(templateRoot, { recursive: true, force: true });
await mkdir(templateRoot, { recursive: true });

for (const relative of allowedFiles) {
  let cursor = projectRoot;
  for (const segment of relative.split('/')) {
    cursor = resolve(cursor, segment);
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) throw new Error(`Link simbólico não permitido no modelo: ${relative}`);
  }
  const source = await realpath(cursor);
  if (!source.startsWith(projectRoot + sep) || !(await lstat(source)).isFile()) throw new Error(`Arquivo de modelo inválido: ${relative}`);
  const destination = resolve(templateRoot, relative);
  if (!destination.startsWith(templateRoot + sep)) throw new Error(`Destino do modelo inválido: ${relative}`);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

const actualFiles = [];
async function walk(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(resolve(directory, entry.name), relative);
    else actualFiles.push(relative);
  }
}
await walk(templateRoot);
if (actualFiles.length !== allowedFiles.size || actualFiles.some((file) => !allowedFiles.has(file))) {
  throw new Error('O modelo empacotado não corresponde à allowlist de runtime.');
}
process.stdout.write(`Modelo local preparado: ${actualFiles.length} arquivos de runtime; sem documentos, testes ou referências.\n`);
