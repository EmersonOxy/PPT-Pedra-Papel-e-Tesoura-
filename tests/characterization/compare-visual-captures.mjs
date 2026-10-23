import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const projectRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const captureRoot = join(projectRoot, 'studio', 'release', 'visual-comparison');
const scenes = ['menu', 'combate-inicial', 'animacao-empate', 'animacao-ataque', 'combate-apos-ataque', 'resultado-final', 'poder-disponivel'];
const viewports = ['1366x768', '390x844'];

function decodePng(buffer) {
  assert.equal(buffer.toString('ascii', 1, 4), 'PNG', 'Arquivo não é PNG.');
  let width;
  let height;
  let depth;
  let colorType;
  const imageData = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') imageData.push(data);
    else if (type === 'IEND') break;
    offset += length + 12;
  }
  assert.equal(depth, 8, 'Somente PNG de 8 bits é suportado.');
  assert.ok(colorType === 2 || colorType === 6, `Tipo de cor PNG não suportado: ${colorType}`);
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(imageData));
  const rowLength = width * bytesPerPixel;
  const pixels = Buffer.alloc(height * rowLength);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const sourceStart = y * (rowLength + 1);
    const filter = raw[sourceStart];
    const rowStart = y * rowLength;
    for (let x = 0; x < rowLength; x++) {
      const value = raw[sourceStart + x + 1];
      const left = x >= bytesPerPixel ? pixels[rowStart + x - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[rowStart + x - rowLength] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? pixels[rowStart + x - rowLength - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upperLeft);
      else assert.equal(filter, 0, `Filtro PNG não suportado: ${filter}`);
      pixels[rowStart + x] = (value + predictor) & 0xff;
    }
  }
  return { width, height, colorType, bytesPerPixel, pixels };
}

for (const viewport of viewports) {
  for (const scene of scenes) {
    const baseline = decodePng(await readFile(join(captureRoot, `baseline-${viewport}-${scene}.png`)));
    const modular = decodePng(await readFile(join(captureRoot, `modular-${viewport}-${scene}.png`)));
    assert.deepEqual([modular.width, modular.height], [baseline.width, baseline.height], `Dimensões divergentes em ${viewport}/${scene}.`);
    assert.equal(modular.bytesPerPixel, baseline.bytesPerPixel, `Formato divergente em ${viewport}/${scene}.`);
    let changed = 0;
    let maximumDelta = 0;
    for (let index = 0; index < baseline.pixels.length; index++) {
      const delta = Math.abs(baseline.pixels[index] - modular.pixels[index]);
      if (delta !== 0) changed++;
      if (delta > maximumDelta) maximumDelta = delta;
    }
    process.stdout.write(`${viewport} ${scene}: ${changed} canais diferentes, delta máximo ${maximumDelta}\n`);
  }
}
