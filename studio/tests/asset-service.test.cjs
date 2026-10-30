const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { importImageAt, MAX_DIMENSION, MAX_FILE_BYTES, MAX_PIXELS, readAssetManifestAt, readRegisteredAssetAt } = require('../electron/asset-service.cjs');

const sourceImage = path.resolve(__dirname, '../../assets/images/hand-paper.png');

async function sandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trindade-assets-'));
  const project = path.join(root, 'project');
  await fs.mkdir(project);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, project };
}

test('imports a validated raster image with a stable project-local identity and no source path', async (t) => {
  const { root, project } = await sandbox(t);
  const source = path.join(root, 'Minha imagem.png');
  await fs.copyFile(sourceImage, source);
  const result = await importImageAt(project, source);
  assert.match(result.asset.id, /^img_[a-f0-9]{32}$/);
  assert.equal(result.asset.file, `assets/imported/${result.asset.id}.png`);
  assert.equal(JSON.stringify(result.assets).includes(root), false);
  assert.deepEqual(await fs.readFile(path.join(project, result.asset.file)), await fs.readFile(source));
  assert.deepEqual(await readAssetManifestAt(project), result.assets);
  assert.deepEqual((await readRegisteredAssetAt(project, result.asset.id)).body, await fs.readFile(source));
  assert.equal((await importImageAt(project, source)).reused, true, 'Conteúdo idêntico reutiliza o mesmo ID sem sobrescrever arquivo.');
});

test('runs the Electron decoder check before writing any project files', async (t) => {
  const { root, project } = await sandbox(t);
  const source = path.join(root, 'decoder-check.png');
  await fs.copyFile(sourceImage, source);
  let decodedFormat = '';
  const result = await importImageAt(project, source, { validateDecoded(_bytes, details) { decodedFormat = details.format; } });
  assert.equal(decodedFormat, 'png');
  await fs.rm(path.join(project, 'assets'), { recursive: true, force: true });
  await assert.rejects(importImageAt(project, source, { validateDecoded() { throw new Error('Electron não reconhece o formato.'); } }), /Electron não reconhece/);
  await assert.rejects(fs.access(path.join(project, 'assets')));
  await assert.rejects(importImageAt(project, source, { async validateDecoded() { await Promise.resolve(); throw new Error('Decodificação assíncrona falhou.'); } }), /Decodificação assíncrona falhou/);
  await assert.rejects(fs.access(path.join(project, 'assets')), 'A validação assíncrona também precisa terminar antes da gravação.');
  assert.equal(result.asset.id.startsWith('img_'), true);
});

test('rejects extension spoofing, malformed/animated images, oversized dimensions and oversized files', async (t) => {
  const { root, project } = await sandbox(t);
  const forged = path.join(root, 'forged.png');
  await fs.writeFile(forged, '<svg onload="alert(1)"></svg>');
  await assert.rejects(importImageAt(project, forged), /Formato não permitido/);

  const badCrc = path.join(root, 'bad.png');
  const invalidPng = await fs.readFile(sourceImage);
  invalidPng[29] ^= 0xff;
  await fs.writeFile(badCrc, invalidPng);
  await assert.rejects(importImageAt(project, badCrc), /Checksum/);

  const tooLarge = path.join(root, 'too-large.png');
  const huge = Buffer.alloc(MAX_FILE_BYTES + 1, 0);
  await fs.writeFile(tooLarge, huge);
  await assert.rejects(importImageAt(project, tooLarge), /limite por imagem/);

  const hugeDimension = path.join(root, 'too-wide.png');
  const largePng = Buffer.from(await fs.readFile(sourceImage));
  largePng.writeUInt32BE(MAX_DIMENSION + 1, 16);
  const crc32 = (buffer) => {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  largePng.writeUInt32BE(crc32(largePng.subarray(12, 29)), 29);
  await fs.writeFile(hugeDimension, largePng);
  await assert.rejects(importImageAt(project, hugeDimension), /excede o limite/);
  assert.equal(MAX_PIXELS, 16_000_000);
});

test('rejects duplicate names, traversal, missing files, unregistered assets and symlinks', async (t) => {
  const { root, project } = await sandbox(t);
  const first = path.join(root, 'first', 'same.png');
  const duplicate = path.join(root, 'second', 'SAME.png');
  await fs.mkdir(path.dirname(first));
  await fs.mkdir(path.dirname(duplicate));
  await fs.copyFile(sourceImage, first);
  const otherImage = path.resolve(__dirname, '../../assets/images/hand-rock.png');
  await fs.copyFile(otherImage, duplicate);
  const imported = await importImageAt(project, first);
  await assert.rejects(importImageAt(project, duplicate), /Já existe uma imagem com esse nome/);
  await assert.rejects(readRegisteredAssetAt(project, 'img_00000000000000000000000000000000'), /não pertence/);
  const registryPath = path.join(project, 'assets/manifest.json');
  const unsafeManifest = structuredClone({ version: 1, assets: imported.assets });
  unsafeManifest.assets[0].file = '../../outside.png';
  await fs.writeFile(registryPath, JSON.stringify(unsafeManifest));
  await assert.rejects(readAssetManifestAt(project), /Metadados.*não correspondem/);
  await fs.writeFile(registryPath, JSON.stringify({ version: 1, assets: imported.assets }));
  await fs.rename(path.join(project, imported.asset.file), path.join(project, imported.asset.file + '.missing'));
  await assert.rejects(readAssetManifestAt(project), /ENOENT|no such file/i);

  const symlinkProject = path.join(root, 'linked-project');
  await fs.mkdir(symlinkProject);
  await fs.symlink(root, path.join(symlinkProject, 'assets'), 'junction');
  const linkedImage = path.join(root, 'linked.png');
  await fs.copyFile(sourceImage, linkedImage);
  await assert.rejects(importImageAt(symlinkProject, linkedImage), /Links simbólicos/);
});
