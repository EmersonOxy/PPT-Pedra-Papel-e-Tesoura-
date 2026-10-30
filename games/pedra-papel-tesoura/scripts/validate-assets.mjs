import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const expected = new Map([
  ['assets/images/hand-rock.png', '05a71eadc23ab5619687003c480446ac09eb8f2ae2677e5355057e9741e01ebb'],
  ['assets/images/hand-paper.png', '8754bf6946fbf237384dc3101face551dd05cd516f9ac616d71ac3d5e83fd2ea'],
  ['assets/images/hand-scissors.png', '974c438af414b7ca78666e4bc83ca36849f0bc7d924c377c985a52ee2f305f23'],
]);

for (const [path, expectedHash] of expected) {
  const bytes = await readFile(path);
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(actualHash, expectedHash, `${path} não corresponde ao asset original incorporado.`);
  assert.equal(bytes.toString('ascii', 1, 4), 'PNG');
  assert.equal(bytes.readUInt32BE(16), 500);
  assert.equal(bytes.readUInt32BE(20), 500);
  assert.equal(bytes[25], 6, `${path} perdeu o canal alpha.`);
}

const originalHtml = await readFile('Jogar-Trindade-transicao-preta.html', 'utf8');
const embeddedHashes = new Set();
for (const match of originalHtml.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)) {
  embeddedHashes.add(createHash('sha256').update(Buffer.from(match[1], 'base64')).digest('hex'));
}
assert.deepEqual([...embeddedHashes].sort(), [...expected.values()].sort(), 'Os assets extraídos não correspondem ao conjunto de imagens do jogo original.');

process.stdout.write(`Asset validation: ${expected.size} imagens PNG aprovadas (500×500, alpha e SHA-256)\n`);
