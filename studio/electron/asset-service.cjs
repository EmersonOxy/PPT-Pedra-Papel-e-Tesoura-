const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const REGISTRY_PATH = 'assets/manifest.json';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_DIMENSION = 4096;
const MAX_PIXELS = 16_000_000;
const MAX_ASSETS = 500;
const FORMATS = Object.freeze({
  png: { mimeType: 'image/png', extensions: ['.png'] },
  jpeg: { mimeType: 'image/jpeg', extensions: ['.jpg', '.jpeg'] },
  webp: { mimeType: 'image/webp', extensions: ['.webp'] },
});
let crcTable;

function pngCrc32(buffer) {
  if (!crcTable) {
    crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
      let current = value;
      for (let bit = 0; bit < 8; bit++) current = (current & 1) ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
      return current >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const value of buffer) crc = crcTable[(crc ^ value) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function safeInteger(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function validateDimensions(width, height) {
  if (!safeInteger(width, 1, MAX_DIMENSION) || !safeInteger(height, 1, MAX_DIMENSION) || width * height > MAX_PIXELS) {
    throw new Error(`A imagem excede o limite de ${MAX_DIMENSION} px por lado ou ${MAX_PIXELS / 1_000_000} MP.`);
  }
  return { width, height };
}

function parsePng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 45 || !buffer.subarray(0, 8).equals(signature)) throw new Error('Conteúdo PNG inválido.');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  let seenIdat = false;
  let seenIend = false;
  let seenHeader = false;
  const compressed = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    if (length > MAX_FILE_BYTES || offset + 12 + length > buffer.length) throw new Error('Estrutura PNG truncada ou inválida.');
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error('Chunk PNG inválido.');
    const checksum = buffer.readUInt32BE(dataEnd);
    if (pngCrc32(buffer.subarray(offset + 4, dataEnd)) !== checksum) throw new Error('Checksum de chunk PNG inválido.');
    if (!seenHeader && type !== 'IHDR') throw new Error('Cabeçalho PNG ausente.');
    if (type === 'IHDR') {
      if (seenHeader || length !== 13) throw new Error('Cabeçalho PNG inválido.');
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      bitDepth = buffer[dataStart + 8];
      colorType = buffer[dataStart + 9];
      const compression = buffer[dataStart + 10];
      const filter = buffer[dataStart + 11];
      interlace = buffer[dataStart + 12];
      if (compression !== 0 || filter !== 0 || ![0, 1].includes(interlace)) throw new Error('PNG com método desconhecido não é compatível.');
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[colorType]?.includes(bitDepth)) throw new Error('Formato de cores PNG inválido.');
      validateDimensions(width, height);
      seenHeader = true;
    } else if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') {
      throw new Error('Imagens animadas não são aceitas.');
    } else if (type === 'IDAT') {
      if (seenIend) throw new Error('Dados PNG após o fim do arquivo.');
      seenIdat = true;
      compressed.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      if (length !== 0 || seenIend || dataEnd + 4 !== buffer.length) throw new Error('Final PNG inválido.');
      seenIend = true;
    }
    offset = dataEnd + 4;
    if (seenIend) break;
  }
  if (!seenHeader || !seenIdat || !seenIend) throw new Error('A imagem PNG está incompleta.');
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType];
  const expectedRawBytes = interlace === 0
    ? height * (1 + Math.ceil(width * channels * bitDepth / 8))
    : [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
      .reduce((total, [startX, startY, stepX, stepY]) => {
        const passWidth = width <= startX ? 0 : Math.ceil((width - startX) / stepX);
        const passHeight = height <= startY ? 0 : Math.ceil((height - startY) / stepY);
        return total + (passWidth && passHeight ? passHeight * (1 + Math.ceil(passWidth * channels * bitDepth / 8)) : 0);
      }, 0);
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(compressed), { maxOutputLength: expectedRawBytes + 1 }); }
  catch { throw new Error('Dados de imagem PNG corrompidos.'); }
  if (raw.length !== expectedRawBytes) throw new Error('Dados de imagem PNG inconsistentes.');
  return { format: 'png', mimeType: FORMATS.png.mimeType, extension: '.png', width, height };
}

function parseJpeg(buffer) {
  if (buffer.length < 16 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer.at(-2) !== 0xff || buffer.at(-1) !== 0xd9) {
    throw new Error('Conteúdo JPEG inválido ou com dados anexados.');
  }
  let offset = 2;
  let dimensions = null;
  while (offset < buffer.length - 2) {
    if (buffer[offset] !== 0xff) throw new Error('Estrutura JPEG inválida.');
    while (buffer[offset] === 0xff) offset++;
    const marker = buffer[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (offset + 2 > buffer.length) throw new Error('Segmento JPEG truncado.');
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) throw new Error('Segmento JPEG inválido.');
    const isSof = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
    if (isSof) {
      if (length < 8) throw new Error('Quadro JPEG inválido.');
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      dimensions = validateDimensions(width, height);
      break;
    }
    offset += length;
  }
  if (!dimensions) throw new Error('JPEG sem quadro de imagem válido.');
  return { format: 'jpeg', mimeType: FORMATS.jpeg.mimeType, extension: '.jpg', ...dimensions };
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function parseWebp(buffer) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP'
    || buffer.readUInt32LE(4) + 8 !== buffer.length) throw new Error('Conteúdo WebP inválido.');
  let offset = 12;
  let dimensions = null;
  let animated = false;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > buffer.length) throw new Error('Chunk WebP truncado.');
    if (type === 'ANIM' || type === 'ANMF') animated = true;
    if (type === 'VP8X') {
      if (length < 10) throw new Error('Cabeçalho WebP inválido.');
      if (buffer[start] & 0x02) animated = true;
      dimensions = validateDimensions(readUInt24LE(buffer, start + 4) + 1, readUInt24LE(buffer, start + 7) + 1);
    } else if (type === 'VP8 ' && length >= 10 && buffer[start + 3] === 0x9d && buffer[start + 4] === 0x01 && buffer[start + 5] === 0x2a) {
      dimensions = validateDimensions(buffer.readUInt16LE(start + 6) & 0x3fff, buffer.readUInt16LE(start + 8) & 0x3fff);
    } else if (type === 'VP8L' && length >= 5 && buffer[start] === 0x2f) {
      const b1 = buffer[start + 1]; const b2 = buffer[start + 2]; const b3 = buffer[start + 3]; const b4 = buffer[start + 4];
      dimensions = validateDimensions(1 + (((b2 & 0x3f) << 8) | b1), 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)));
    }
    offset = end + (length & 1);
  }
  if (offset !== buffer.length || !dimensions || animated) throw new Error(animated ? 'Imagens animadas não são aceitas.' : 'WebP sem quadro estático válido.');
  return { format: 'webp', mimeType: FORMATS.webp.mimeType, extension: '.webp', ...dimensions };
}

function inspectImageBuffer(buffer, originalPath) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_FILE_BYTES) {
    throw new Error(`O arquivo deve ter entre 1 byte e ${MAX_FILE_BYTES / 1024 / 1024} MiB.`);
  }
  let image;
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) image = parsePng(buffer);
  else if (buffer.subarray(0, 4).toString('ascii') === 'RIFF') image = parseWebp(buffer);
  else if (buffer[0] === 0xff && buffer[1] === 0xd8) image = parseJpeg(buffer);
  else throw new Error('Formato não permitido. Escolha uma imagem PNG, JPEG ou WebP estática.');
  const extension = path.extname(originalPath).toLowerCase();
  if (!FORMATS[image.format].extensions.includes(extension)) throw new Error('A extensão do arquivo não corresponde ao conteúdo real da imagem.');
  return { ...image, size: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
}

function displayName(originalPath) {
  const raw = path.basename(originalPath, path.extname(originalPath)).normalize('NFC');
  const name = raw.replace(/[^\p{L}\p{N} _.-]/gu, '_').replace(/[. ]+$/u, '').trim().slice(0, 80);
  if (!name || name === '.' || name === '..') throw new Error('O nome da imagem não pode ser usado na biblioteca.');
  return name;
}

function validateAssetRecord(asset) {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)
    || Object.keys(asset).sort().join(',') !== 'file,height,id,mimeType,name,sha256,size,width') throw new Error('Registro de imagem inválido.');
  const match = /^img_([a-f0-9]{32})$/.exec(asset.id);
  const ext = path.extname(asset.file);
  const expected = Object.values(FORMATS).find((format) => format.mimeType === asset.mimeType);
  if (!match || !expected || !expected.extensions.includes(ext) || asset.file !== `assets/imported/${asset.id}${ext}`
    || typeof asset.name !== 'string' || !asset.name || asset.name.length > 80 || /[\\/\0]/.test(asset.name)
    || !/^[a-f0-9]{64}$/.test(asset.sha256) || !asset.sha256.startsWith(match[1])
    || !safeInteger(asset.size, 1, MAX_FILE_BYTES)) throw new Error('Metadados da imagem não correspondem ao formato permitido.');
  validateDimensions(asset.width, asset.height);
}

async function safeFileAt(root, relative, { optional = false } = {}) {
  const normalizedRoot = await fs.realpath(root);
  const target = path.resolve(normalizedRoot, ...relative.split('/'));
  if (!target.startsWith(normalizedRoot + path.sep)) throw new Error('O recurso aponta para fora do projeto.');
  let cursor = normalizedRoot;
  for (const segment of relative.split('/')) {
    cursor = path.join(cursor, segment);
    let info;
    try { info = await fs.lstat(cursor); }
    catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
    if (info.isSymbolicLink()) throw new Error('Links simbólicos não são aceitos nos assets do projeto.');
    if (cursor === target && !info.isFile()) throw new Error('O asset registrado não é um arquivo.');
    if (cursor !== target && !info.isDirectory()) throw new Error('A pasta do asset não é segura.');
  }
  const resolved = await fs.realpath(target);
  if (!resolved.startsWith(normalizedRoot + path.sep)) throw new Error('O asset escapou da pasta do projeto.');
  return resolved;
}

async function readAssetManifestAt(root, { verifyFiles = true } = {}) {
  const registryPath = await safeFileAt(root, REGISTRY_PATH, { optional: true });
  if (!registryPath) return [];
  const raw = JSON.parse(await fs.readFile(registryPath, 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== 1 || !Array.isArray(raw.assets)) {
    throw new Error('A biblioteca de imagens do projeto usa um formato incompatível.');
  }
  if (raw.assets.length > MAX_ASSETS) throw new Error(`A biblioteca excede o limite de ${MAX_ASSETS} imagens por projeto.`);
  const ids = new Set();
  const names = new Set();
  for (const asset of raw.assets) {
    validateAssetRecord(asset);
    const nameKey = asset.name.toLocaleLowerCase('en-US');
    if (ids.has(asset.id) || names.has(nameKey)) throw new Error('A biblioteca contém IDs ou nomes de imagem duplicados.');
    ids.add(asset.id);
    names.add(nameKey);
    if (verifyFiles) {
      const file = await safeFileAt(root, asset.file);
      const bytes = await fs.readFile(file);
      const details = inspectImageBuffer(bytes, asset.file);
      if (details.sha256 !== asset.sha256 || details.size !== asset.size || details.width !== asset.width || details.height !== asset.height || details.mimeType !== asset.mimeType) {
        throw new Error(`O arquivo registrado ${asset.name} foi alterado ou está corrompido.`);
      }
    }
  }
  return raw.assets;
}

async function ensureDirectoryAt(root, relative) {
  const normalizedRoot = await fs.realpath(root);
  let cursor = normalizedRoot;
  for (const segment of relative.split('/')) {
    cursor = path.join(cursor, segment);
    try { await fs.mkdir(cursor); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const info = await fs.lstat(cursor);
    if (info.isSymbolicLink() || !info.isDirectory() || !(await fs.realpath(cursor)).startsWith(normalizedRoot + path.sep)) {
      throw new Error('A pasta de recursos do projeto não é segura.');
    }
  }
}

async function importImageAt(projectRoot, sourcePath, { validateDecoded } = {}) {
  const root = await fs.realpath(projectRoot);
  const rootInfo = await fs.lstat(projectRoot);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('O projeto ativo não é uma pasta real.');
  const sourceInfo = await fs.lstat(sourcePath);
  if (sourceInfo.isSymbolicLink() || !sourceInfo.isFile()) throw new Error('Selecione um arquivo de imagem normal, sem links simbólicos.');
  if (sourceInfo.size < 1 || sourceInfo.size > MAX_FILE_BYTES) throw new Error(`O limite por imagem é ${MAX_FILE_BYTES / 1024 / 1024} MiB.`);
  const sourceHandle = await fs.open(sourcePath, 'r');
  let bytes;
  try {
    const openedInfo = await sourceHandle.stat();
    if (!openedInfo.isFile() || openedInfo.size !== sourceInfo.size || (openedInfo.ino && sourceInfo.ino && openedInfo.ino !== sourceInfo.ino)) {
      throw new Error('O arquivo selecionado mudou durante a importação.');
    }
    bytes = await sourceHandle.readFile();
  } finally { await sourceHandle.close(); }
  const details = inspectImageBuffer(bytes, sourcePath);
  if (validateDecoded) await validateDecoded(bytes, details);
  const name = displayName(sourcePath);
  const current = await readAssetManifestAt(root);
  const hashPrefix = details.sha256.slice(0, 32);
  const id = `img_${hashPrefix}`;
  const existingId = current.find((asset) => asset.id === id);
  if (existingId) {
    if (existingId.sha256 !== details.sha256) throw new Error('Colisão de identificador de imagem; nenhum arquivo foi substituído.');
    return { assets: current, asset: existingId, reused: true };
  }
  if (current.length >= MAX_ASSETS) throw new Error(`O projeto já atingiu o limite de ${MAX_ASSETS} imagens.`);
  if (current.some((asset) => asset.name.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'))) {
    throw new Error('Já existe uma imagem com esse nome neste projeto. Renomeie o arquivo antes de importar.');
  }
  await ensureDirectoryAt(root, 'assets/imported');
  const asset = { id, name, file: `assets/imported/${id}${details.extension}`, mimeType: details.mimeType, size: details.size, width: details.width, height: details.height, sha256: details.sha256 };
  const destination = await safeFileAt(root, asset.file, { optional: true });
  if (destination) throw new Error('O arquivo de destino já existe; nenhum recurso foi substituído.');
  const absoluteFile = path.resolve(root, ...asset.file.split('/'));
  const handle = await fs.open(absoluteFile, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  const registryPath = await safeFileAt(root, REGISTRY_PATH, { optional: true });
  const registryAbsolute = path.resolve(root, ...REGISTRY_PATH.split('/'));
  const tempPath = `${registryAbsolute}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    const handle = await fs.open(tempPath, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify({ version: 1, assets: [...current, asset] }, null, 2)}\n`, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await fs.rename(tempPath, registryAbsolute);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    await fs.unlink(absoluteFile).catch(() => {});
    throw new Error(`Não foi possível registrar a imagem. O projeto foi preservado. ${error.message}`);
  }
  return { assets: [...current, asset], asset, reused: false };
}

async function readRegisteredAssetAt(projectRoot, id) {
  if (typeof id !== 'string' || !/^img_[a-f0-9]{32}$/.test(id)) throw new Error('Identificador de imagem inválido.');
  const root = await fs.realpath(projectRoot);
  const assets = await readAssetManifestAt(root, { verifyFiles: false });
  const asset = assets.find((entry) => entry.id === id);
  if (!asset) throw new Error('A imagem não pertence à biblioteca do projeto ativo.');
  const file = await safeFileAt(root, asset.file);
  const body = await fs.readFile(file);
  const details = inspectImageBuffer(body, asset.file);
  if (details.sha256 !== asset.sha256 || details.size !== asset.size || details.width !== asset.width || details.height !== asset.height || details.mimeType !== asset.mimeType) {
    throw new Error(`O arquivo registrado ${asset.name} foi alterado ou está corrompido.`);
  }
  return { asset, body };
}

module.exports = {
  MAX_DIMENSION,
  MAX_ASSETS,
  MAX_FILE_BYTES,
  MAX_PIXELS,
  REGISTRY_PATH,
  importImageAt,
  inspectImageBuffer,
  readAssetManifestAt,
  readRegisteredAssetAt,
  validateAssetRecord,
};
