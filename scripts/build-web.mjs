import { copyFile, lstat, mkdir, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const outputParent = resolve(projectRoot, 'dist');
const outputRoot = resolve(outputParent, 'web');
const allowedFiles = [
  'index.html',
  'config/editor-elements.schema.json',
  'config/visual.json',
  'assets/styles/game.css',
  'assets/images/hand-rock.png',
  'assets/images/hand-paper.png',
  'assets/images/hand-scissors.png',
  'src/game/main.js',
  'src/game/core/rules.js',
  'src/game/ui/game-animations.js',
  'src/game/ui/game-ui.js',
  'src/game/ui/game-view.js',
  'src/game/ui/turn-clock.js',
  'src/game/ui/visual-config.js',
];

if (dirname(outputRoot) !== outputParent || outputParent === projectRoot) {
  throw new Error('Diretório de saída inválido.');
}

async function collectFiles(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) throw new Error(`Arquivo oculto inesperado na entrada web: ${entry.name}`);
    const source = resolve(directory, entry.name);
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    const info = await lstat(source);
    if (info.isSymbolicLink()) throw new Error(`Links simbólicos não são aceitos no build web: ${path}`);
    if (info.isDirectory()) result.push(...await collectFiles(source, path));
    else if (info.isFile()) result.push(path);
    else throw new Error(`Tipo de arquivo não permitido no build web: ${path}`);
  }
  return result;
}

for (const path of allowedFiles) {
  let current = projectRoot;
  const parts = path.split('/');
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part.startsWith('.')) throw new Error(`Arquivo oculto não permitido: ${path}`);
    current = resolve(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error(`Links simbólicos não são aceitos no build web: ${path}`);
    const isLast = index === parts.length - 1;
    if (isLast ? !info.isFile() : !info.isDirectory()) {
      throw new Error(`Arquivo web obrigatório ausente ou inválido: ${path}`);
    }
  }
}

const entry = await realpath(resolve(projectRoot, 'index.html'));
if (!entry.startsWith(projectRoot + sep)) throw new Error('A entrada web escapou da raiz do projeto.');
const html = await readFile(entry, 'utf8');
if (!html.includes('./src/game/main.js') || !html.includes('./assets/styles/game.css')) {
  throw new Error('index.html não referencia os módulos e o CSS esperados.');
}

await mkdir(outputParent, { recursive: true });
try {
  const parentInfo = await lstat(outputParent);
  if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory()) throw new Error('dist deve ser um diretório real, não um link.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
try {
  const outputInfo = await lstat(outputRoot);
  if (outputInfo.isSymbolicLink() || !outputInfo.isDirectory()) throw new Error('dist/web deve ser um diretório gerado real.');
  await rm(outputRoot, { recursive: true, force: true });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(outputRoot, { recursive: true });

for (const path of allowedFiles) {
  const source = resolve(projectRoot, path);
  const resolvedSource = await realpath(source);
  if (!resolvedSource.startsWith(projectRoot + sep)) throw new Error(`Arquivo fora da raiz: ${path}`);
  const destination = resolve(outputRoot, path);
  if (!destination.startsWith(outputRoot + sep)) throw new Error(`Destino fora da saída: ${path}`);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(resolvedSource, destination);
}

const built = (await collectFiles(outputRoot)).sort();
const expected = allowedFiles.slice().sort();
if (built.length !== expected.length || built.some((path, index) => path !== expected[index])) {
  throw new Error('A saída contém arquivos ausentes ou não autorizados.');
}

process.stdout.write(`Build web criado em dist/web: ${built.length} arquivos explicitamente permitidos; arquivos extras e internos excluídos.\n`);
