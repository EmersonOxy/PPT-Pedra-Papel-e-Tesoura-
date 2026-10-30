import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const studioRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repositoryRoot = resolve(studioRoot, '..', 'games', 'pedra-papel-tesoura');
const packageRoot = join(studioRoot, 'release');
const executable = process.env.TRINDADE_STUDIO_TEST_EXE || join(packageRoot, 'win-unpacked', 'Trindade Studio.exe');
const expectedVersion = process.env.TRINDADE_STUDIO_EXPECTED_VERSION || JSON.parse(await readFile(join(studioRoot, 'package.json'), 'utf8')).version;
const screenshotPath = join(packageRoot, 'Trindade-Studio-proof.png');
const sceneScreenshotRoot = join(packageRoot, 'scene-browser');
const projectCenterScreenshotRoot = join(packageRoot, 'project-center');
const inspectorScreenshotRoot = join(packageRoot, 'inspector');
const require = createRequire(import.meta.url);
const allowedFiles = require('../electron/project-service.cjs').allowedFiles;

function report(phase) {
  process.stdout.write(`[Studio smoke] ${phase}\n`);
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  return port;
}

async function waitFor(check, label, timeout = 20000) {
  const end = Date.now() + timeout;
  let lastError;
  while (Date.now() < end) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) { lastError = error; }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timeout aguardando ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

async function capturePage(session) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); }
    catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
  }
  throw lastError;
}

function taskkillTree(pid) {
  if (process.platform === 'win32' && pid) {
    try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  }
}

async function launch(exe, profile, fixture, debugPort, extraEnvironment = {}) {
  const child = spawn(exe, [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${debugPort}`,
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      TRINDADE_PROJECT_ROOT: fixture,
      TRINDADE_STUDIO_TEST_MODE: '1',
      TRINDADE_STUDIO_TEST_HIDDEN: process.env.TRINDADE_STUDIO_TEST_HIDDEN || '1',
      TRINDADE_STUDIO_DEBUG_PORT: String(debugPort),
      TRINDADE_STUDIO_TEST_USER_DATA: join(profile, 'app-data'),
      ...extraEnvironment,
    },
  });
  const output = [];
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  child.once('error', (error) => { child.launchError = error; });
  child.output = output;
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`O executável encerrou com exit code ${child.exitCode}. ${output.join('').slice(-3000)}`);
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
    return response.ok ? response.json() : null;
  }, 'endpoint CDP do executável empacotado');
  const page = await waitFor(async () => {
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    return targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  }, 'janela renderer do Studio');
  return { child, page };
}

async function attach(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener('open', resolvePromise, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const pending = new Map();
  const contexts = new Map();
  const consoleErrors = [];
  const networkFailures = [];
  const requests = new Map();
  let nextId = 1;
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.executionContextCreated') {
      const { id, auxData } = message.params.context;
      if (auxData?.isDefault && auxData.frameId) contexts.set(auxData.frameId, id);
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((arg) => arg.value || arg.description || '').join(' '));
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const exception = message.params.exceptionDetails;
      consoleErrors.push(exception.exception?.description || exception.text);
    }
    if (message.method === 'Network.requestWillBeSent') requests.set(message.params.requestId, message.params.request.url);
    if (message.method === 'Network.loadingFailed') networkFailures.push({
      url: requests.get(message.params.requestId) || '',
      errorText: message.params.errorText,
      canceled: message.params.canceled === true || message.params.errorText === '',
    });
    if (message.id && pending.has(message.id)) {
      const { resolve: resolvePromise, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolvePromise(message.result || {});
    }
  });

  const send = (method, params = {}) => new Promise((resolvePromise, reject) => {
    const id = nextId++;
    pending.set(id, { resolve: resolvePromise, reject });
    socket.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 15000).unref?.();
  });
  const evaluate = async (expression, contextId) => {
    const result = await send('Runtime.evaluate', { expression, contextId, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  };
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Page.enable');
  return { socket, send, evaluate, contexts, consoleErrors, networkFailures };
}

const externalRoot = process.env.TRINDADE_STUDIO_TEST_ROOT ? resolve(process.env.TRINDADE_STUDIO_TEST_ROOT) : null;
const temporary = externalRoot || await mkdtemp(join(tmpdir(), 'trindade-studio-package-smoke-'));
const ownsTemporary = externalRoot === null;
const fixture = process.env.TRINDADE_STUDIO_TEST_PROJECT_ROOT
  ? resolve(process.env.TRINDADE_STUDIO_TEST_PROJECT_ROOT)
  : join(temporary, 'game-project');
const profile = process.env.TRINDADE_STUDIO_TEST_PROFILE_ROOT
  ? resolve(process.env.TRINDADE_STUDIO_TEST_PROFILE_ROOT)
  : join(temporary, 'electron-profile');
await mkdir(temporary, { recursive: true });
await mkdir(profile, { recursive: true });
await mkdir(fixture, { recursive: true });
for (const relative of allowedFiles) {
  const destination = join(fixture, relative);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(repositoryRoot, relative), destination);
}
await copyFile(join(repositoryRoot, 'config/gameplay.local.json'), join(fixture, 'config/gameplay.local.json'));
const assetSamplePath = process.env.TRINDADE_STUDIO_TEST_IMPORT_PATH
  ? resolve(process.env.TRINDADE_STUDIO_TEST_IMPORT_PATH)
  : join(temporary, 'asset-samples', 'Studio-spark.png');
if (!process.env.TRINDADE_STUDIO_TEST_IMPORT_PATH) {
  await mkdir(dirname(assetSamplePath), { recursive: true });
  await copyFile(join(repositoryRoot, 'assets/images/hand-paper.png'), assetSamplePath);
}
await access(executable);

let child;
let session;
try {
  const port = await availablePort();
  ({ child } = await launch(executable, profile, fixture, port, { TRINDADE_STUDIO_TEST_IMPORT_PATH: assetSamplePath }));
  session = await attach((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((target) => target.type === 'page'));
  report('janela empacotada aberta');

  const studio = await waitFor(async () => {
    const state = await session.evaluate(`(() => ({
    project: document.querySelector('.project-name')?.textContent,
    scenes: document.querySelectorAll('.scene-item[role="option"]').length,
    layers: document.querySelectorAll('.layer-item[role="option"]').length,
    preview: document.querySelector('iframe')?.src,
    status: document.querySelector('.canvas-statusbar')?.innerText,
    nodeAccess: [typeof window.require, typeof window.process],
    api: Object.keys(window.trindadeStudio || {}),
    body: document.body.innerText,
  }))()`);
    return state.scenes === 8 && state.project !== 'Nenhum projeto aberto' && state.layers >= 3
      || state.body.includes('Não foi possível carregar') ? state : null;
  }, 'interface React e projeto em edição');
  assert.equal(studio.scenes, 8, `O navegador não apresentou as oito cenas cadastradas: ${JSON.stringify(studio)}`);
  assert.equal(studio.layers, 3, `O menu deve listar seu cartão, título e botão registrados: ${JSON.stringify(studio)}`);
  assert.match(studio.preview, /^http:\/\/127\.0\.0\.1:/, 'A prévia não usa servidor local isolado.');
  assert.deepEqual(studio.nodeAccess, ['undefined', 'undefined'], 'O renderer recebeu acesso Node inesperado.');
  assert.deepEqual(studio.api.sort(), ['checkForUpdates', 'chooseProjectParent', 'closeStudio', 'createProject', 'getAssetPreview', 'getHomeState', 'getProject', 'importImage', 'onCloseRequest', 'onHistoryCommand', 'onOpenProjectRequest', 'onReturnHomeRequest', 'onSaveRequest', 'openProject', 'openRecentProject', 'openReleasePage', 'removeRecentProject', 'requestHome', 'respondToClose', 'saveVisualConfig', 'setDirty'].sort());
  report('renderer isolado, oito cenas e três camadas de menu verificadas');

  let frameId = await waitFor(async () => {
    const { frameTree } = await session.send('Page.getFrameTree');
    const iframe = frameTree.childFrames?.find((frame) => new URL(frame.frame.url).pathname === '/');
    return iframe?.frame.id;
  }, 'frame da prévia real');
  let frameContext = await waitFor(() => session.contexts.get(frameId), 'contexto isolado do jogo');
  async function waitForReloadedFrame(previousContext, label) {
    return waitFor(async () => {
      const { frameTree } = await session.send('Page.getFrameTree');
      const frame = frameTree.childFrames?.find((entry) => new URL(entry.frame.url).pathname === '/');
      if (!frame) return null;
      const context = session.contexts.get(frame.frame.id);
      if (!context || context === previousContext) return null;
      frameId = frame.frame.id;
      return context;
    }, label);
  }
  try {
    await waitFor(() => session.evaluate(`document.querySelector('.canvas-statusbar')?.innerText.includes('Modo de edição')`), 'protocolo da prévia', 5000);
  } catch (error) {
    const diagnostics = {
      status: await session.evaluate(`document.querySelector('.canvas-statusbar')?.innerText`),
      iframe: await session.evaluate(`document.querySelector('iframe')?.src`),
      frame: await session.evaluate(`({href:location.href,ready:document.readyState,title:document.title,body:document.body.innerText.slice(0,400)})`, frameContext),
      consoleErrors: session.consoleErrors,
      networkFailures: session.networkFailures,
    };
    throw new Error(`${error.message}; diagnóstico: ${JSON.stringify(diagnostics)}`);
  }
  assert.equal(await session.evaluate(`fetch('/docs/STUDIO_ARCHITECTURE.md').then(r=>r.status)`, frameContext), 404,
    'A prévia publicou um arquivo interno.');
  assert.equal(await session.evaluate(`fetch('/__studio/scenes.json').then(r=>r.status)`, frameContext), 404,
    'O catálogo de cenas foi servido sem a origem e a sessão de teste.');
  report('prévia real carregada e arquivos internos bloqueados');

  async function selectScene(id, expression, label, screenshotName) {
    await session.evaluate(`document.querySelector('[data-scene-id="${id}"]').click()`);
    await waitFor(() => session.evaluate(expression, frameContext), label);
    if (screenshotName) {
      await mkdir(sceneScreenshotRoot, { recursive: true });
      const captured = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await writeFile(join(sceneScreenshotRoot, screenshotName), Buffer.from(captured.data, 'base64'));
    }
  }

  await selectScene('menu', `!document.querySelector('#menu-screen').hidden && document.querySelector('#game-screen').hidden`, 'menu', 'Trindade-Studio-menu.png');
  await selectScene('combat', `document.querySelector('#menu-screen').hidden && !document.querySelector('#game-screen').hidden && document.querySelector('#end-screen').hidden && document.querySelector('#enemy-hp').textContent === '100 / 100'`, 'combate sem iniciar partida', 'Trindade-Studio-combate.png');
  await selectScene('battle-win', `!document.querySelector('#end-screen').hidden && document.querySelector('#end-title').textContent === 'Você venceu o combate!'`, 'resultado de vitória no combate', 'Trindade-Studio-resultado-combate.png');
  await selectScene('reward', `document.querySelector('#end-summary').textContent.includes('Luck Block: Cura!') && document.querySelector('#use-heal strong').textContent === '1'`, 'recompensa determinística', 'Trindade-Studio-recompensa.png');
  await selectScene('match-win', `document.querySelector('#end-title').textContent === 'Você venceu a partida!' && document.querySelector('#end-summary').textContent.includes('10 × 4')`, 'vitória da partida');
  await selectScene('match-loss', `document.querySelector('#end-title').textContent === 'O inimigo venceu a partida!' && document.querySelector('#end-summary').textContent.includes('6 × 10')`, 'derrota da partida');
  await selectScene('timeout-loss', `document.querySelector('#end-summary').textContent.includes('perdeu por inatividade') && document.querySelector('#missed-count').textContent === '3 / 3 faltas'`, 'derrota por inatividade');
  await selectScene('battle-loss', `document.querySelector('#end-title').textContent === 'O inimigo venceu o combate!'`, 'derrota no combate');
  await selectScene('menu', `!document.querySelector('#menu-screen').hidden && document.querySelector('#game-screen').hidden`, 'retorno ao menu');
  report('menu, combate, resultados/recompensa e retorno ao menu navegados no Electron real');

  await session.evaluate(`document.querySelector('[data-editor-id="game.title"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`, frameContext);
  await waitFor(() => session.evaluate(`document.querySelector('.selected-element-card')?.innerText.includes('game.title')`), 'seleção direta no canvas');
  await mkdir(inspectorScreenshotRoot, { recursive: true });
  const saveInspectorScreenshot = async (name) => {
    const captured = await capturePage(session);
    await writeFile(join(inspectorScreenshotRoot, name), Buffer.from(captured.data, 'base64'));
  };
  await saveInspectorScreenshot('inspector-before.png');
  const titleInput = await session.evaluate(`document.querySelector('input[id^="property-"]').id`);
  const titleInputId = JSON.stringify(titleInput);
  const newTitle = 'Título Studio validado';
  await session.evaluate(`(() => {
    const input = document.getElementById(${titleInputId});
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(newTitle)});
    input.dispatchEvent(new Event('input', {bubbles:true}));
    input.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="game.title"]').textContent === ${JSON.stringify(newTitle)}`, frameContext), 'aplicação da propriedade à prévia em tempo real');
  report('seleção direta e edição ao vivo verificadas');

  await session.evaluate(`document.querySelector('button[title^="Desfazer"]').click()`);
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="game.title"]').textContent === 'Pedra, papel e tesoura'`, frameContext), 'desfazer na prévia');
  await session.evaluate(`document.querySelector('button[title^="Refazer"]').click()`);
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="game.title"]').textContent === ${JSON.stringify(newTitle)}`, frameContext), 'refazer na prévia');
  report('undo/redo verificados');

  const setInspectorValue = async (id, value, type) => session.evaluate(`(() => {
    const input=document.getElementById(${JSON.stringify(id)});
    if (!input) throw new Error('Controle de propriedade ausente: ${id}');
    const prototype = ${JSON.stringify(type === 'select' ? 'HTMLSelectElement' : type === 'checkbox' ? 'HTMLInputElement' : 'HTMLInputElement')};
    if (${JSON.stringify(type)} === 'checkbox') {
      if (input.checked !== ${JSON.stringify(value)}) input.click();
      return;
    }
    const setter=Object.getOwnPropertyDescriptor(window[prototype].prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event(${JSON.stringify(type === 'select' ? 'change' : 'input')},{bubbles:true}));
    if (${JSON.stringify(type)} !== 'select') input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await setInspectorValue('property-game.title.fontFamily.base', 'Georgia', 'select');
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="game.title"]').style.getPropertyValue('--studio-font-family') === 'Georgia'`, frameContext), 'fonte do título aplicada');
  await setInspectorValue('property-number-game.title.fontSize.desktop', '42', 'number');
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="game.title"]').style.getPropertyValue('--studio-font-size') === '42px'`, frameContext), 'tamanho do título aplicado');
  await setInspectorValue('property-game.title.textColor.base', '#123456', 'text');
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="game.title"]').style.getPropertyValue('--studio-text-color') === '#123456'`, frameContext), 'cor do texto aplicada');
  await session.evaluate(`document.querySelector('button[title^="Desfazer"]').click()`);
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="game.title"]').style.getPropertyValue('--studio-text-color') === ''`, frameContext), 'undo da cor do título');
  await session.evaluate(`document.querySelector('button[title^="Refazer"]').click()`);
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="game.title"]').style.getPropertyValue('--studio-text-color') === '#123456'`, frameContext), 'redo da cor do título');
  await saveInspectorScreenshot('inspector-title-after.png');

  await session.evaluate(`document.querySelector('[data-element-id="menu.start"]').click()`);
  await waitFor(() => session.evaluate(`document.querySelector('.selected-element-card')?.innerText.includes('menu.start')`), 'seleção do botão Jogar no inspetor');
  await setInspectorValue('property-menu.start.backgroundColor.base', '#234567', 'text');
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="menu.start"]').style.getPropertyValue('--studio-background-color') === '#234567'`, frameContext), 'aparência do botão Jogar aplicada');
  await setInspectorValue('property-menu.start.textColor.base', '#f1e2d3', 'text');
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="menu.start"]').style.getPropertyValue('--studio-text-color') === '#f1e2d3'`, frameContext), 'cor do texto do botão aplicada');

  await session.evaluate(`document.querySelector('[data-element-id="menu.card"]').click()`);
  await waitFor(() => session.evaluate(`document.querySelector('.selected-element-card')?.innerText.includes('menu.card')`), 'seleção do cartão do menu');
  await setInspectorValue('property-number-menu.card.opacity.desktop', '0.75', 'number');
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="menu.card"]').style.getPropertyValue('--studio-opacity') === '0.75'`, frameContext), 'opacidade do cartão aplicada');
  await session.evaluate(`document.querySelector('button[title^="Desfazer"]').click()`);
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="menu.card"]').style.getPropertyValue('--studio-opacity') === ''`, frameContext), 'undo da opacidade do cartão');
  await session.evaluate(`document.querySelector('button[title^="Refazer"]').click()`);
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="menu.card"]').style.getPropertyValue('--studio-opacity') === '0.75'`, frameContext), 'redo da opacidade do cartão');
  await setInspectorValue('property-menu.card.visible.desktop', false, 'checkbox');
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="menu.card"]').hidden === true`, frameContext), 'visibilidade do cartão desativada');
  await session.evaluate(`document.querySelector('button[title^="Desfazer"]').click()`);
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="menu.card"]').hidden === false`, frameContext), 'undo da visibilidade do cartão');
  await session.evaluate(`document.querySelector('button[title^="Refazer"]').click()`);
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="menu.card"]').hidden === true`, frameContext), 'redo da visibilidade do cartão');
  assert.equal(await session.evaluate(`Boolean(document.querySelector('[data-element-id="menu.card"]'))`), true, 'Elemento oculto deve continuar recuperável na lista de camadas.');
  await saveInspectorScreenshot('inspector-appearance-hidden.png');
  await setInspectorValue('property-menu.card.visible.desktop', true, 'checkbox');
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="menu.card"]').hidden === false`, frameContext), 'restauração de visibilidade do cartão');
  await selectScene('combat', `!document.querySelector('#game-screen').hidden && document.querySelector('#end-screen').hidden`, 'Arena para validação do inspetor');
  await session.evaluate(`document.querySelector('[data-element-id="arena.background"]').click()`);
  await waitFor(() => session.evaluate(`document.querySelector('.selected-element-card')?.innerText.includes('arena.background')`), 'seleção do componente da Arena');
  assert.equal(await session.evaluate(`Boolean(document.getElementById('property-number-arena.background.opacity.desktop'))`), true, 'A Arena deve expor opacidade registrada.');
  assert.equal(await session.evaluate(`Boolean(document.getElementById('property-arena.background.fontFamily.base'))`), false, 'A Arena não deve exibir fonte incompatível.');
  await setInspectorValue('property-number-arena.background.opacity.desktop', '0.6', 'number');
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="arena.background"]').style.getPropertyValue('--studio-opacity') === '0.6'`, frameContext), 'opacidade da arena aplicada');
  await saveInspectorScreenshot('inspector-arena-after.png');
  report('inspetor avançado: fonte, tamanho, cores, opacidade, visibilidade, camadas e undo/redo verificados');

  const geometryCapture = async (name) => {
    const alignment = () => session.evaluate(`(() => {
      const target=document.querySelector('[data-editor-id="menu.start"]');
      const overlay=document.querySelector('.trindade-geometry-overlay');
      if (!target || !overlay) return null;
      const a=target.getBoundingClientRect(), b=overlay.getBoundingClientRect();
      return {hidden:overlay.hidden, target:{left:a.left,top:a.top,width:a.width,height:a.height}, overlay:{left:b.left,top:b.top,width:b.width,height:b.height}};
    })()`, frameContext);
    try {
      await waitFor(async () => {
        const value = await alignment();
        return value && !value.hidden && ['left','top','width','height'].every((key) => Math.abs(value.target[key] - value.overlay[key]) < 2);
      }, `contorno alinhado com o elemento antes de ${name}`, 5000);
    } catch (error) {
      throw new Error(`${error.message}; alinhamento atual=${JSON.stringify(await alignment())}`);
    }
    const captured = await capturePage(session);
    await mkdir(join(packageRoot, 'geometry'), { recursive: true });
    await writeFile(join(packageRoot, 'geometry', name), Buffer.from(captured.data, 'base64'));
  };
  await selectScene('menu', `!document.querySelector('#menu-screen').hidden && document.querySelector('#game-screen').hidden`, 'retorno ao menu após inspeção da Arena');
  await session.evaluate("document.querySelector('[data-element-id=\\\"menu.start\\\"]').click()");
  await waitFor(() => session.evaluate("document.querySelector('.selected-element-card')?.innerText.includes('menu.start')"), 'seleção do botão do menu');
  await geometryCapture('menu-before.png');
  const frameRect = await session.evaluate("(() => { const rect=document.querySelector('iframe').getBoundingClientRect(); return {x:rect.left,y:rect.top}; })()");
  const targetRect = await session.evaluate("(() => { const rect=document.querySelector('[data-editor-id=\\\"menu.start\\\"]').getBoundingClientRect(); return {x:rect.left,y:rect.top,width:rect.width,height:rect.height}; })()", frameContext);
  const startPoint = { x: frameRect.x + targetRect.x + targetRect.width / 2, y: frameRect.y + targetRect.y + targetRect.height / 2 };
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startPoint.x, y: startPoint.y });
  await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPoint.x, y: startPoint.y, button: 'left', clickCount: 1 });
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startPoint.x + 28, y: startPoint.y + 17, button: 'left' });
  await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPoint.x + 28, y: startPoint.y + 17, button: 'left' });
  await waitFor(() => session.evaluate("document.querySelector('.geometry-field input[aria-label=\\\"x em pixels\\\"]')?.value !== '0'"), 'arraste do elemento do menu');
  assert.equal(await session.evaluate("document.querySelector('[data-editor-id=\\\"game.title\\\"]').textContent", frameContext), newTitle,
    'A geometria de outro objeto não deve reverter a edição de texto pendente.');
  const desktopX = Number(await session.evaluate("document.querySelector('.geometry-field input[aria-label=\\\"x em pixels\\\"]').value"));
  const desktopY = Number(await session.evaluate("document.querySelector('.geometry-field input[aria-label=\\\"y em pixels\\\"]').value"));
  const assertPendingTitle = async (step) => assert.equal(await session.evaluate("document.querySelector('[data-editor-id=\\\"game.title\\\"]').textContent", frameContext), newTitle, `A geometria em ${step} não deve descartar o texto pendente.`);
  await assertPendingTitle('arraste');
  assert.ok(desktopX >= -180 && desktopX <= 180 && desktopY >= -180 && desktopY <= 180, 'O arraste deve respeitar limites.');
  const handleRect = await session.evaluate("(() => { const rect=document.querySelector('.trindade-geometry-overlay .handle-se').getBoundingClientRect(); return {x:rect.left,y:rect.top,width:rect.width,height:rect.height}; })()", frameContext);
  const handlePoint = { x: frameRect.x + handleRect.x + handleRect.width / 2, y: frameRect.y + handleRect.y + handleRect.height / 2 };
  const beforeWidth = Number(await session.evaluate("document.querySelector('.geometry-field input[aria-label=\\\"width em pixels\\\"]').value"));
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handlePoint.x, y: handlePoint.y });
  await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handlePoint.x, y: handlePoint.y, button: 'left', clickCount: 1 });
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handlePoint.x + 22, y: handlePoint.y + 12, button: 'left' });
  await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handlePoint.x + 22, y: handlePoint.y + 12, button: 'left' });
  await waitFor(() => session.evaluate("Number(document.querySelector('.geometry-field input[aria-label=\\\"width em pixels\\\"]')?.value) > " + beforeWidth), 'redimensionamento pela alça');
  await assertPendingTitle('redimensionamento');
  const setGeometryField = async (field, value) => session.evaluate(`(() => {
    const input=document.querySelector('.geometry-field input[aria-label="${field} em pixels"]');
    if (!input) throw new Error('Campo geométrico ausente: ${field}');
    const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    set.call(input,${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await setGeometryField('width', 190);
  await waitFor(() => session.evaluate("document.querySelector('[data-editor-id=\\\"menu.start\\\"]').style.getPropertyValue('--studio-geometry-width') === '190px'", frameContext), 'campo numérico de largura');
  await assertPendingTitle('campo de largura');
  await setGeometryField('height', 62);
  await waitFor(() => session.evaluate("document.querySelector('[data-editor-id=\\\"menu.start\\\"]').style.getPropertyValue('--studio-geometry-height') === '62px'", frameContext), 'campo numérico de altura');
  await assertPendingTitle('campo de altura');
  await setGeometryField('y', 19);
  await waitFor(() => session.evaluate("document.querySelector('[data-editor-id=\\\"menu.start\\\"]').style.getPropertyValue('--studio-geometry-y') === '19px'", frameContext), 'campo numérico Y');
  await assertPendingTitle('campo Y');
  await session.evaluate("document.querySelector('button[title=\\\"Visualização celular\\\"]').click()");
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="game.title"]').textContent === ${JSON.stringify(newTitle)}`, frameContext), 'reaplicação das alterações pendentes na visualização celular');
  await geometryCapture('menu-mobile-before.png');
  const mobileFrameRect = await session.evaluate("(() => { const rect=document.querySelector('iframe').getBoundingClientRect(); return {x:rect.left,y:rect.top}; })()");
  const mobileTargetRect = await session.evaluate("(() => { const rect=document.querySelector('[data-editor-id=\\\"menu.start\\\"]').getBoundingClientRect(); return {x:rect.left,y:rect.top,width:rect.width,height:rect.height}; })()", frameContext);
  const mobileStartPoint = { x: mobileFrameRect.x + mobileTargetRect.x + mobileTargetRect.width / 2, y: mobileFrameRect.y + mobileTargetRect.y + mobileTargetRect.height / 2 };
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mobileStartPoint.x, y: mobileStartPoint.y });
  await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mobileStartPoint.x, y: mobileStartPoint.y, button: 'left', clickCount: 1 });
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mobileStartPoint.x + 14, y: mobileStartPoint.y + 10, button: 'left' });
  await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mobileStartPoint.x + 14, y: mobileStartPoint.y + 10, button: 'left' });
  await waitFor(() => session.evaluate("Number(document.querySelector('.geometry-field input[aria-label=\\\"x em pixels\\\"]')?.value) !== " + desktopX), 'arraste da geometria na prévia celular');
  await assertPendingTitle('arraste celular');
  const draggedMobileX = Number(await session.evaluate("document.querySelector('.geometry-field input[aria-label=\\\"x em pixels\\\"]').value"));
  const draggedMobileY = Number(await session.evaluate("document.querySelector('.geometry-field input[aria-label=\\\"y em pixels\\\"]').value"));
  await setGeometryField('x', 12);
  await waitFor(() => session.evaluate("document.querySelector('.geometry-field input[aria-label=\\\"x em pixels\\\"]')?.value === '12'"), 'override de posição no celular');
  await waitFor(() => session.evaluate("document.querySelector('[data-editor-id=\\\"menu.start\\\"]').style.getPropertyValue('--studio-geometry-x') === '12px'", frameContext), 'valor celular aplicado à prévia');
  await setGeometryField('x', draggedMobileX);
  await waitFor(() => session.evaluate("Number(document.querySelector('.geometry-field input[aria-label=\\\"x em pixels\\\"]')?.value) === " + draggedMobileX), 'restauração numérica da posição mostrada após arraste');
  await waitFor(() => session.evaluate("document.querySelector('[data-editor-id=\\\"menu.start\\\"]').style.getPropertyValue('--studio-geometry-x') === '" + draggedMobileX + "px'", frameContext), 'posição celular final aplicada à prévia');
  await geometryCapture('menu-mobile-after.png');
  await session.evaluate("document.querySelector('button[title=\\\"Visualização desktop\\\"]').click()");
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="game.title"]').textContent === ${JSON.stringify(newTitle)}`, frameContext), 'reaplicação das alterações pendentes na visualização desktop');
  assert.equal(Number(await session.evaluate("document.querySelector('.geometry-field input[aria-label=\\\"x em pixels\\\"]').value")), desktopX, 'O breakpoint mobile não deve alterar X desktop.');
  await geometryCapture('menu-after.png');
  report('arraste desktop/celular, campos X/Y/largura/altura, redimensionamento e capturas antes/depois verificados');

  await session.evaluate("document.querySelector('button[title^=\\\"Desfazer\\\"]').click()");
  await session.evaluate("document.querySelector('button[title^=\\\"Refazer\\\"]').click()");
  await waitFor(() => session.evaluate("Number(document.querySelector('.geometry-field input[aria-label=\\\"x em pixels\\\"]')?.value) === " + desktopX), 'undo/redo geométrico');
  await session.evaluate("document.querySelector('.geometry-reset').click()");
  await waitFor(() => session.evaluate("!document.querySelector('[data-editor-id=\\\"menu.start\\\"]').hasAttribute('data-trindade-geometry')", frameContext), 'reset remove override visual');
  await session.evaluate("document.querySelector('button[title^=\\\"Desfazer\\\"]').click()");
  await waitFor(() => session.evaluate("document.querySelector('[data-editor-id=\\\"menu.start\\\"]').dataset.trindadeGeometry === 'flow-box'", frameContext), 'undo do reset de geometria');
  await session.evaluate("document.querySelector('button[title^=\\\"Refazer\\\"]').click()");
  await waitFor(() => session.evaluate("!document.querySelector('[data-editor-id=\\\"menu.start\\\"]').hasAttribute('data-trindade-geometry')", frameContext), 'redo do reset de geometria');
  await session.evaluate("document.querySelector('button[title^=\\\"Desfazer\\\"]').click()");
  await waitFor(() => session.evaluate("document.querySelector('[data-editor-id=\\\"menu.start\\\"]').dataset.trindadeGeometry === 'flow-box'", frameContext), 'restauração final do override para salvar');

  await selectScene('combat', `!document.querySelector('#game-screen').hidden && document.querySelector('#end-screen').hidden`, 'retorno ao estado de combate');
  await session.evaluate(`document.querySelector('[data-editor-id="arena.background"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`, frameContext);
  await waitFor(() => session.evaluate(`document.querySelector('.selected-element-card')?.innerText.includes('arena.background')`), 'seleção do elemento de cor');
  await session.evaluate(`document.querySelector('[data-editor-id="controls.move.rock"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`, frameContext);
  await session.evaluate(`(() => { const target=document.querySelector('[data-editor-id="arena.background"]'); target.hidden=true; target.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,clientX:5,clientY:5})); target.dispatchEvent(new MouseEvent('click',{bubbles:true})); })()`, frameContext);
  assert.match(await session.evaluate(`document.querySelector('.selected-element-card')?.innerText || ''`), /controls\.move\.rock/, 'Um elemento oculto não deve ser selecionável diretamente.');
  await session.evaluate(`document.querySelector('[data-editor-id="arena.background"]').hidden=false`, frameContext);
  await session.evaluate(`document.querySelector('[data-editor-id="arena.background"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`, frameContext);
  await waitFor(() => session.evaluate(`document.querySelector('.selected-element-card')?.innerText.includes('arena.background')`), 'seleção restaurada da arena');
  await session.evaluate(`(() => {
    const input = document.getElementById('property-arena.background.backgroundColor.base');
    if (!(input instanceof HTMLInputElement)) throw new Error('Campo de cor ausente: ' + document.querySelector('.selected-element-card')?.innerText + ' / ' + [...document.querySelectorAll('[id^="property-"]')].map((item) => item.id).join(','));
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '#123456');
    input.dispatchEvent(new Event('input', {bubbles:true}));
    input.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="arena.background"]').style.getPropertyValue('--arena-background') === '#123456'`, frameContext), 'alteração de cor aplicada à prévia');
  await session.evaluate("(() => { const input=document.querySelector('.geometry-field input[aria-label=\\\"y em pixels\\\"]'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(input,'24'); input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); })()");
  await waitFor(() => session.evaluate("document.querySelector('[data-editor-id=\\\"arena.background\\\"]').style.getPropertyValue('--studio-geometry-y') === '24px'", frameContext), 'edição geométrica da arena');

  await session.evaluate(`document.querySelector('[data-editor-id="controls.move.rock"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`, frameContext);
  await waitFor(() => session.evaluate(`document.querySelector('.selected-element-card')?.innerText.includes('controls.move.rock')`), 'seleção de controle com propriedade compartilhada');
  await session.evaluate(`(() => {
    const input = document.getElementById('property-controls.move.rock.backgroundColor.base');
    if (!(input instanceof HTMLInputElement)) throw new Error('Campo de cor ausente: ' + document.querySelector('.selected-element-card')?.innerText + ' / ' + [...document.querySelectorAll('[id^="property-"]')].map((item) => item.id).join(','));
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '#123456');
    input.dispatchEvent(new Event('input', {bubbles:true}));
    input.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="controls.move.rock"]').style.getPropertyValue('--move-button-background') === '#123456'`, frameContext), 'cor aplicada ao botão selecionado');
  assert.equal(await session.evaluate(`document.querySelector('[data-editor-id="controls.move.paper"]').style.getPropertyValue('--move-button-background')`, frameContext), '#fafaf7', 'A propriedade de cor do botão selecionado alterou também outro botão que compartilha o mesmo tipo de vínculo.');

  await session.evaluate(`document.querySelector('[data-editor-id="hands.player.image"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`, frameContext);
  await waitFor(() => session.evaluate(`document.querySelector('.selected-element-card')?.innerText.includes('hands.player.image')`), 'seleção da imagem do jogador');
  await session.evaluate(`(() => {
    const input = document.getElementById('property-hands.player.image.assetId.base');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(input, 'hands.paper');
    input.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="hands.player.image"]').getAttribute('src') === './assets/images/hand-paper.png'`, frameContext), 'seleção de imagem permitida aplicada à prévia');
  report('edição de cor, imagem permitida e isolamento das propriedades compartilhadas verificados');

  await session.evaluate(`document.querySelector('.asset-import-button').click()`);
  await waitFor(() => session.evaluate(`document.querySelector('[data-asset-id]')?.dataset.assetId || [...document.querySelectorAll('.toast')].some((node) => /imagem|import|asset|arquivo/i.test(node.innerText))`), 'importação de imagem para biblioteca do projeto');
  const importDiagnostic = await session.evaluate(`({assets:document.querySelectorAll('[data-asset-id]').length,status:[...document.querySelectorAll('.toast')].map(node=>node.innerText)})`);
  assert.ok(importDiagnostic.assets > 0, `Importação sem asset. Diagnóstico: ${JSON.stringify(importDiagnostic)}`);
  const importedAssetId = await session.evaluate(`document.querySelector('[data-asset-id]').dataset.assetId`);
  try {
    await waitFor(() => session.evaluate(`(() => { const image=document.querySelector('[data-asset-id] img'); return Boolean(image?.complete && image.naturalWidth > 0); })()`), 'miniatura do asset carregada na biblioteca');
  } catch (error) {
    const thumbnailState = await session.evaluate(`(async () => { const image=document.querySelector('[data-asset-id] img'); let response=''; try { response=await fetch(image.src).then(value=>String(value.status)); } catch (failure) { response=String(failure); } return {src:image?.src,complete:image?.complete,naturalWidth:image?.naturalWidth,outerHTML:image?.outerHTML,response,location:location.href}; })()`);
    let httpAssetState;
    try { const response = await fetch(thumbnailState.src); httpAssetState = { status: response.status, contentType: response.headers.get('content-type'), bytes: (await response.arrayBuffer()).byteLength }; }
    catch (fetchError) { httpAssetState = String(fetchError); }
    const csp = await session.evaluate(`fetch('/').then(response => response.headers.get('content-security-policy'))`);
    throw new Error(`${error.message}; miniatura=${JSON.stringify(thumbnailState)}; http=${JSON.stringify(httpAssetState)}; csp=${csp}; console=${JSON.stringify(session.consoleErrors.slice(-8))}; rede=${JSON.stringify(session.networkFailures.slice(-8))}`);
  }
  await session.evaluate(`document.querySelector('[data-element-id="hands.player.image"]').click()`);
  await waitFor(() => session.evaluate(`document.querySelector('.selected-element-card')?.innerText.includes('hands.player.image')`), 'seleção do elemento para asset importado');
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  await setInspectorValue('property-hands.player.image.assetId.base', importedAssetId, 'select');
  const importedPreviewSrc = await waitFor(async () => session.evaluate(`(() => { const image=document.querySelector('[data-editor-id="hands.player.image"]'); return image?.getAttribute('src')?.includes('/assets/imported/${importedAssetId}?') && image.complete && image.naturalWidth > 0 ? image.getAttribute('src') : null; })()`, frameContext), 'asset importado servido pelo projeto e decodificado na prévia');
  assert.equal((await readFile(join(fixture, 'assets/manifest.json'), 'utf8')).includes(importedAssetId), true);
  await mkdir(inspectorScreenshotRoot, { recursive: true });
  await writeFile(join(inspectorScreenshotRoot, 'asset-library-imported.png'), Buffer.from((await capturePage(session)).data, 'base64'));
  await session.evaluate(`document.querySelector('button[title^="Desfazer"]').click()`);
  await waitFor(() => session.evaluate(`document.getElementById('property-hands.player.image.assetId.base')?.value === 'hands.paper'`), 'undo de atribuição do asset');
  await session.evaluate(`document.querySelector('button[title^="Refazer"]').click()`);
  await waitFor(() => session.evaluate(`document.getElementById('property-hands.player.image.assetId.base')?.value === '${importedAssetId}'`), 'redo de atribuição do asset');
  assert.match(importedPreviewSrc, new RegExp(`/assets/imported/${importedAssetId}\\?`));
  report('asset importado na biblioteca, atribuído pelo inspetor, decodificado e com undo/redo');

  await session.evaluate(`document.querySelector('button.button-test').click()`);
  await waitFor(() => session.evaluate(`document.querySelector('.canvas-statusbar')?.innerText.includes('Modo de teste')`), 'modo de teste');
  frameContext = await waitForReloadedFrame(frameContext, 'prévia real recarregada em modo teste');
  await waitFor(() => session.evaluate(`document.documentElement.dataset.studioMode === 'test'`, frameContext), 'confirmação do modo de teste na prévia');
  assert.equal(await session.evaluate(`!document.querySelector('#menu-screen').hidden && document.querySelector('#game-screen').hidden`, frameContext), true,
    'O modo Testar deve iniciar no menu real do jogo, sem fixture de cena.');
  const match = await session.evaluate(`(async () => {
    const frame = document.querySelector('iframe');
    const deadline = Date.now() + 10000;
    while (!frame.contentWindow || Date.now() > deadline) await new Promise(r=>setTimeout(r,50));
    return true;
  })()`);
  assert.equal(match, true);
  await session.evaluate(`(() => {
    const originalMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => query === '(prefers-reduced-motion: reduce)'
      ? { matches: true, media: query, addEventListener() {}, removeEventListener() {} }
      : originalMatchMedia(query);
    Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {}, id: '' });
  })()`, frameContext);
  await waitFor(() => session.evaluate(`typeof document.querySelector('#start-game')?.onclick === 'function'`, frameContext), 'controles do jogo inicializados');
  await session.evaluate(`document.getElementById('start-game').click()`, frameContext);
  try {
    await waitFor(() => session.evaluate(`!document.querySelector('#game-screen').hidden`, frameContext), 'início de partida pela prévia');
  } catch (error) {
    const diagnostics = await session.evaluate(`({
      mode:document.documentElement.dataset.studioMode,
      menuHidden:document.querySelector('#menu-screen')?.hidden,
      gameHidden:document.querySelector('#game-screen')?.hidden,
      startDisabled:document.querySelector('#start-game')?.disabled,
      startHandler:typeof document.querySelector('#start-game')?.onclick,
      curtainHidden:document.querySelector('#transition-curtain')?.hidden,
      consoleErrors:${JSON.stringify(session.consoleErrors)},
    })`, frameContext);
    throw new Error(`${error.message}; diagnóstico: ${JSON.stringify(diagnostics)}`);
  }
  const beforeMove = await session.evaluate(`({player:document.querySelector('#player-hp').textContent, enemy:document.querySelector('#enemy-hp').textContent})`, frameContext);
  await session.evaluate(`document.querySelector('[data-sign="rock"]').click()`, frameContext);
  try {
    await waitFor(async () => {
      const state = await session.evaluate(`({
        player:document.querySelector('#player-hp').textContent,
        enemy:document.querySelector('#enemy-hp').textContent,
        status:document.querySelector('#turn-status').textContent,
        message:document.querySelector('#message').textContent,
      })`, frameContext);
      return state.status === 'Sua vez' && (state.player !== beforeMove.player || state.enemy !== beforeMove.enemy || state.message.includes('Empate'));
    }, 'resolução de uma jogada na partida');
  } catch (error) {
    const diagnostics = await session.evaluate(`({
      player:document.querySelector('#player-hp')?.textContent,
      enemy:document.querySelector('#enemy-hp')?.textContent,
      status:document.querySelector('#turn-status')?.textContent,
      message:document.querySelector('#message')?.textContent,
      selected:[...document.querySelectorAll('[data-sign]')].filter(button=>button.classList.contains('selected')).map(button=>button.dataset.sign),
      disabled:[...document.querySelectorAll('[data-sign]')].map(button=>button.disabled),
      beforeMove:${JSON.stringify(beforeMove)},
    })`, frameContext);
    throw new Error(`${error.message}; diagnóstico: ${JSON.stringify(diagnostics)}; console: ${JSON.stringify(session.consoleErrors)}; rede: ${JSON.stringify(session.networkFailures)}`);
  }
  report('partida iniciada e jogada resolvida');

  await session.evaluate(`document.querySelector('button.button-test').click()`);
  await waitFor(() => session.evaluate(`document.querySelector('.canvas-statusbar')?.innerText.includes('Modo de edição')`), 'retorno ao modo de edição');
  frameContext = await waitForReloadedFrame(frameContext, 'prévia real recarregada no modo de edição');
  await waitFor(() => session.evaluate(`document.documentElement.dataset.studioMode === 'edit'`, frameContext), 'retorno da prévia ao modo de edição');
  let editReturnState = {};
  try { await waitFor(async () => {
    const uiState = await session.evaluate(`({dirty:document.querySelector('.save-state').classList.contains('is-dirty'), asset:document.getElementById('property-hands.player.image.assetId.base')?.value})`);
    const previewAsset = await session.evaluate(`document.querySelector('[data-editor-id="hands.player.image"]').getAttribute('src')`, frameContext);
    const previewScene = await session.evaluate(`document.querySelector('#menu-screen').hidden && !document.querySelector('#game-screen').hidden && document.querySelector('#end-screen').hidden`, frameContext);
    editReturnState = { uiState, previewAsset, previewScene, previewMode: await session.evaluate(`document.documentElement.dataset.studioMode`, frameContext), previewErrors: session.consoleErrors.slice(-3) };
    return uiState.dirty && uiState.asset === importedAssetId && previewAsset.includes(`/assets/imported/${importedAssetId}?`) && previewScene;
  }, 'preservação das alterações não salvas ao retornar de Testar'); }
  catch (error) { throw new Error(`${error.message}; estado após retorno: ${JSON.stringify(editReturnState)}`); }
  await session.evaluate(`document.querySelector('button.save-button').click()`);
  await waitFor(() => readFile(join(fixture, 'config/visual.json'), 'utf8').then((raw) => JSON.parse(raw).elements['game.title'].base.text === newTitle), 'salvamento persistente');
  const geometrySaved = JSON.parse(await readFile(join(fixture, 'config/visual.json'), 'utf8'));
  assert.equal(geometrySaved.elements['game.title'].base.fontFamily, 'Georgia');
  assert.equal(geometrySaved.elements['game.title'].base.fontSize, 42);
  assert.equal(geometrySaved.elements['game.title'].base.textColor, '#123456');
  assert.equal(geometrySaved.elements['menu.start'].base.backgroundColor, '#234567');
  assert.equal(geometrySaved.elements['menu.card'].base.opacity, 0.75);
  assert.equal(geometrySaved.elements['menu.card'].base.visible, true, 'O cartão deve estar visível ao salvar.');
  assert.equal(geometrySaved.elements['arena.background'].base.opacity, 0.6);
  assert.deepEqual(geometrySaved.elements['menu.start'].geometry.base, { x: desktopX, y: 19, width: 190, height: 62 }, 'A geometria desktop salva deve corresponder ao estado mostrado.');
  assert.deepEqual(geometrySaved.elements['menu.start'].geometry.responsive.mobile, { x: draggedMobileX, y: draggedMobileY, width: 190, height: 62 }, 'A geometria mobile salva deve coincidir com o estado mostrado após o arraste.');
  assert.equal(geometrySaved.elements['arena.background'].geometry.base.y, 24, 'A geometria da arena deve ser salva.');
  assert.equal(geometrySaved.elements['hands.player.image'].base.assetId, importedAssetId, 'A atribuição do asset importado deve ser salva.');
  assert.equal(await readFile(join(fixture, 'config/visual.json.bak'), 'utf8').then((raw) => JSON.parse(raw).elements['game.title'].base.text), 'Pedra, papel e tesoura', 'O backup não preservou a configuração anterior.');
  report('configuração salva com backup');

  await session.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await session.evaluate(`document.querySelector('button[title="Visualização celular"]').click()`);
  assert.equal(await session.evaluate(`document.querySelector('.preview-frame-wrap').classList.contains('mobile-preview')`), true, 'A prévia celular não alterou o enquadramento.');
  await selectScene('menu', `!document.querySelector('#menu-screen').hidden && document.querySelector('#game-screen').hidden`, 'menu para edição de tipografia responsiva');
  await session.evaluate(`document.querySelector('[data-element-id="game.title"]').click()`);
  await waitFor(() => session.evaluate(`document.querySelector('.selected-element-card')?.innerText.includes('game.title')`), 'título selecionado para override responsivo');
  await setInspectorValue('property-number-game.title.fontSize.mobile', '38', 'number');
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="game.title"]').style.getPropertyValue('--studio-font-size') === '38px'`, frameContext), 'tamanho de fonte celular aplicado');
  await session.send('Emulation.clearDeviceMetricsOverride');
  await session.evaluate(`document.querySelector('button[title="Visualização desktop"]').click()`);
  try {
    await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="game.title"]').style.getPropertyValue('--studio-font-size') === '42px'`, frameContext), 'valor desktop preservado após ajuste celular');
  } catch (error) {
    const responsiveDebug = await session.evaluate(`({frameRect:document.querySelector('iframe')?.getBoundingClientRect().toJSON(),fontSize:document.querySelector('[data-editor-id="game.title"]')?.style.getPropertyValue('--studio-font-size'),innerWidth,matchMobile:matchMedia('(max-width: 600px)').matches})`, frameContext);
    const editorDebug = await session.evaluate(`({desktopActive:document.querySelector('button[title="Visualização desktop"]')?.className,mobileActive:document.querySelector('button[title="Visualização celular"]')?.className,desktopValue:document.getElementById('property-number-game.title.fontSize.desktop')?.value,mobileValue:document.getElementById('property-number-game.title.fontSize.mobile')?.value,mode:document.querySelector('.canvas-statusbar')?.innerText})`);
    throw new Error(`${error.message}; estado desktop responsivo=${JSON.stringify(responsiveDebug)}; estado do editor=${JSON.stringify(editorDebug)}`);
  }
  await session.evaluate(`document.querySelector('button[title="Visualização celular"]').click()`);
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="game.title"]').style.getPropertyValue('--studio-font-size') === '38px'`, frameContext), 'retorno ao valor móvel próprio');
  await session.evaluate(`document.querySelector('button.save-button').click()`);
  await waitFor(() => readFile(join(fixture, 'config/visual.json'), 'utf8').then((raw) => JSON.parse(raw).elements['game.title'].responsive.mobile.fontSize === 38), 'override responsivo salvo');
  assert.equal(JSON.parse(await readFile(join(fixture, 'config/visual.json'), 'utf8')).elements['game.title'].base.fontSize, 42, 'A edição celular não pode substituir o valor desktop.');
  await session.evaluate(`document.querySelector('button[title="Visualização desktop"]').click()`);
  await session.send('Emulation.clearDeviceMetricsOverride');
  await capturePage(session).then((result) => writeFile(screenshotPath, Buffer.from(result.data, 'base64')));
  report('prévia mobile e captura de tela verificadas');
  assert.deepEqual(session.consoleErrors, [], `Console do Studio/jogo: ${session.consoleErrors.join('; ')}`);
  assert.deepEqual(session.networkFailures.filter((failure) => !failure.canceled), [], `Falhas de rede: ${JSON.stringify(session.networkFailures)}`);

  await session.evaluate('setTimeout(() => window.trindadeStudio.closeStudio(), 200); true');
  await waitFor(() => new Promise((resolvePromise) => child.exitCode !== null ? resolvePromise(true) : setTimeout(() => resolvePromise(false), 100)), 'fechamento normal do Studio');
  session.socket.close();
  session = null;
  await waitFor(() => new Promise((resolvePromise) => child.exitCode !== null ? resolvePromise(true) : setTimeout(() => resolvePromise(false), 100)), 'fechamento do primeiro processo');
  const secondPort = await availablePort();
  ({ child } = await launch(executable, profile, fixture, secondPort));
  report('aplicativo reaberto');
  const reopenedTarget = (await (await fetch(`http://127.0.0.1:${secondPort}/json/list`)).json()).find((target) => target.type === 'page');
  session = await attach(reopenedTarget);
  await waitFor(() => session.evaluate(`document.querySelector('input[id^="property-"]')?.value === ${JSON.stringify(newTitle)}`), 'persistência ao reabrir o executável');
  assert.equal(await session.evaluate(`document.getElementById('property-game.title.fontFamily.base')?.value`), 'Georgia');
  assert.equal(await session.evaluate(`document.getElementById('property-number-game.title.fontSize.desktop')?.value`), '42');
  assert.equal(await session.evaluate(`document.getElementById('property-game.title.textColor.base')?.value`), '#123456');
  const reopenedTree = await session.send('Page.getFrameTree');
  const reopenedFrameId = reopenedTree.frameTree.childFrames.find((f) => new URL(f.frame.url).pathname === '/').frame.id;
  const reopenedFrameContext = await waitFor(() => session.contexts.get(reopenedFrameId), 'contexto da prévia após reabrir');
  frameContext = reopenedFrameContext;
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="game.title"]').style.getPropertyValue('--studio-font-family') === 'Georgia'`, reopenedFrameContext), 'fonte persistida aplicada à prévia depois de reabrir');
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="hands.player.image"]').getAttribute('src')?.includes('/assets/imported/${importedAssetId}?') && document.querySelector('[data-editor-id="hands.player.image"]').complete && document.querySelector('[data-editor-id="hands.player.image"]').naturalWidth > 0`, reopenedFrameContext), 'asset importado persistiu e decodificou após reabrir');
  assert.equal(await session.evaluate(`document.querySelector('[data-editor-id="game.title"]').style.getPropertyValue('--studio-font-size')`, reopenedFrameContext), '42px');
  assert.equal(await session.evaluate(`document.querySelector('[data-editor-id="game.title"]').style.getPropertyValue('--studio-font-color')`, reopenedFrameContext), '');
  assert.equal(await session.evaluate(`document.querySelector('[data-editor-id="game.title"]').style.getPropertyValue('--studio-text-color')`, reopenedFrameContext), '#123456');
  await session.evaluate("document.querySelector('[data-element-id=\\\"menu.start\\\"]').click()");
  assert.equal(await session.evaluate(`document.getElementById('property-menu.start.backgroundColor.base')?.value`), '#234567');
  assert.equal(await session.evaluate(`document.getElementById('property-menu.start.textColor.base')?.value`), '#f1e2d3');
  await session.evaluate(`document.querySelector('[data-element-id="menu.card"]').click()`);
  assert.equal(await session.evaluate(`document.getElementById('property-number-menu.card.opacity.desktop')?.value`), '0.75');
  await session.evaluate(`document.querySelector('[data-scene-id="combat"]').click()`);
  await waitFor(() => session.evaluate(`!document.querySelector('#game-screen').hidden && document.querySelector('#end-screen').hidden`, reopenedFrameContext), 'retorno à Arena para validar valores persistidos');
  await session.evaluate(`document.querySelector('[data-element-id="arena.background"]').click()`);
  assert.equal(await session.evaluate(`document.getElementById('property-number-arena.background.opacity.desktop')?.value`), '0.6');
  await session.evaluate(`document.querySelector('.inspector-reset').click()`);
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="arena.background"]').style.getPropertyValue('--studio-opacity') === ''`, reopenedFrameContext), 'restauração visual da Arena');
  await session.evaluate(`document.querySelector('[data-scene-id="menu"]').click()`);
  await waitFor(() => session.evaluate(`!document.querySelector('#menu-screen').hidden && document.querySelector('#game-screen').hidden`, reopenedFrameContext), 'retorno ao Menu para restaurar outros elementos');
  await session.evaluate(`document.querySelector('[data-element-id="game.title"]').click()`);
  await session.evaluate(`document.querySelector('.inspector-reset').click()`);
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="game.title"]').textContent === 'Pedra, papel e tesoura' && document.querySelector('[data-editor-id="game.title"]').style.getPropertyValue('--studio-font-family') === ''`, reopenedFrameContext), 'restauração dos valores originais do título');
  await session.evaluate(`document.querySelector('[data-element-id="menu.start"]').click()`);
  await session.evaluate(`document.querySelector('.inspector-reset').click()`);
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="menu.start"]').style.getPropertyValue('--studio-background-color') === ''`, reopenedFrameContext), 'restauração visual do botão');
  await session.evaluate(`document.querySelector('[data-element-id="menu.card"]').click()`);
  await session.evaluate(`document.querySelector('.inspector-reset').click()`);
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="menu.card"]').style.getPropertyValue('--studio-opacity') === ''`, reopenedFrameContext), 'restauração visual do cartão');
  await session.evaluate(`document.querySelector('button.save-button').click()`);
  await waitFor(() => readFile(join(fixture, 'config/visual.json'), 'utf8').then((raw) => {
    const config=JSON.parse(raw);
    return config.elements['game.title'].base.text === 'Pedra, papel e tesoura'
      && !config.elements['game.title'].base.fontFamily
      && !config.elements['game.title'].base.fontSize
      && !config.elements['game.title'].responsive?.mobile?.fontSize
      && !config.elements['menu.start'].base.backgroundColor
      && !config.elements['menu.card'].base.opacity
      && !config.elements['arena.background'].base.opacity;
  }), 'defaults visuais restaurados e salvos');
  await selectScene('menu', `!document.querySelector('#menu-screen').hidden && document.querySelector('#game-screen').hidden`, 'Menu após restaurar defaults visuais');
  await session.evaluate(`document.querySelector('[data-element-id="menu.start"]').click()`);
  await waitFor(() => session.evaluate(`document.querySelector('.selected-element-card')?.innerText.includes('menu.start')`), 'botão Jogar selecionado após reabrir');
  await waitFor(() => session.evaluate("Number(document.querySelector('.geometry-field input[aria-label=\\\"x em pixels\\\"]')?.value) === " + desktopX), 'persistência da geometria ao reabrir');
  assert.deepEqual(session.consoleErrors, [], `Console após reabrir: ${session.consoleErrors.join('; ')}`);
  await session.evaluate('setTimeout(() => window.trindadeStudio.closeStudio(), 200); true');
  await waitFor(() => new Promise((resolvePromise) => child.exitCode !== null ? resolvePromise(true) : setTimeout(() => resolvePromise(false), 100)), 'fechamento normal após reabertura');
  session.socket.close();
  session = null;

  const homeProfile = join(temporary, 'project-center-profile');
  const homeProjects = join(temporary, 'project-center-projects');
  await mkdir(homeProfile, { recursive: true });
  const homePort = await availablePort();
  ({ child } = await launch(executable, homeProfile, fixture, homePort, {
    TRINDADE_STUDIO_TEST_HOME: '1',
    TRINDADE_STUDIO_TEST_PROJECTS_DIR: homeProjects,
    TRINDADE_STUDIO_TEST_IMPORT_PATH: assetSamplePath,
  }));
  report('Central de Projetos aberta no Electron real');
  const homeTarget = (await (await fetch(`http://127.0.0.1:${homePort}/json/list`)).json()).find((target) => target.type === 'page');
  session = await attach(homeTarget);
  await waitFor(() => session.evaluate(`Boolean(document.querySelector('.home-shell'))`), 'Central de Projetos');
  await waitFor(() => session.evaluate(`document.querySelector('.home-version strong')?.textContent !== 'v—' && Boolean(document.querySelector('.projects-location strong')?.textContent)`), 'carregamento da versão e localização padrão');
  const homeApi = await session.evaluate(`({api:Object.keys(window.trindadeStudio).sort(),version:document.querySelector('.home-version strong')?.textContent,location:document.querySelector('.projects-location strong')?.textContent})`);
  assert.equal(homeApi.version, `v${expectedVersion}`);
  assert.equal(homeApi.location, homeProjects);
  await mkdir(projectCenterScreenshotRoot, { recursive: true });
  const saveHomeScreenshot = async (name) => {
    if (process.env.TRINDADE_STUDIO_TEST_HIDDEN === '1') return;
    const captured = await capturePage(session);
    await writeFile(join(projectCenterScreenshotRoot, name), Buffer.from(captured.data, 'base64'));
  };
  await saveHomeScreenshot('Trindade-Studio-central.png');
  const newProjectButton = `document.querySelector('.home-create').click()`;
  await session.evaluate(newProjectButton);
  await waitFor(() => session.evaluate(`Boolean(document.querySelector('#new-project-name'))`), 'assistente de novo projeto');
  await saveHomeScreenshot('Trindade-Studio-novo-projeto.png');
  const typeProjectName = async (name) => {
    await session.evaluate(`(() => {
      const input = document.querySelector('#new-project-name');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(name)});
      input.dispatchEvent(new Event('input', {bubbles:true}));
      input.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
    await session.evaluate(`([...document.querySelectorAll('button')].find((button) => button.innerText.trim() === 'Criar projeto')).click()`);
    await waitFor(() => session.evaluate(`document.querySelector('.project-name')?.textContent === ${JSON.stringify(name)}`), `criação do projeto ${name}`);
  };
  await typeProjectName('Projeto Central Um');
  const firstProjectRoot = join(homeProjects, 'Projeto Central Um');
  await waitFor(() => readFile(join(firstProjectRoot, 'trindade.project.json'), 'utf8').then((raw) => JSON.parse(raw).projectFormatVersion === 1), 'manifesto versionado do primeiro projeto');
  const firstTitle = 'Projeto Central Um — título independente';
  await session.evaluate(`(() => {
    const input = document.getElementById('property-game.title.text.base');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(firstTitle)});
    input.dispatchEvent(new Event('input', {bubbles:true}));
    input.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await session.evaluate(`document.querySelector('button.save-button').click()`);
  await waitFor(() => readFile(join(firstProjectRoot, 'config/visual.json'), 'utf8').then((raw) => JSON.parse(raw).elements['game.title'].base.text === firstTitle), 'salvamento no primeiro projeto');
  await session.evaluate(`document.querySelector('.asset-import-button').click()`);
  await waitFor(() => session.evaluate(`document.querySelector('[data-asset-id]')?.dataset.assetId`), 'importação do asset no primeiro projeto da Central');
  const firstProjectAssetId = await session.evaluate(`document.querySelector('[data-asset-id]').dataset.assetId`);
  assert.equal((await readFile(join(firstProjectRoot, 'assets/manifest.json'), 'utf8')).includes(firstProjectAssetId), true);
  await session.evaluate(`([...document.querySelectorAll('button')].find((button) => button.innerText.trim() === 'Projetos')).click()`);
  await waitFor(() => session.evaluate(`Boolean(document.querySelector('.home-shell'))`), 'retorno limpo à Central de Projetos');
  await session.evaluate(newProjectButton);
  await waitFor(() => session.evaluate(`Boolean(document.querySelector('#new-project-name'))`), 'segundo assistente de projeto');
  await typeProjectName('Projeto Central Dois');
  const secondProjectRoot = join(homeProjects, 'Projeto Central Dois');
  await waitFor(() => readFile(join(secondProjectRoot, 'trindade.project.json'), 'utf8').then((raw) => JSON.parse(raw).projectFormatVersion === 1), 'manifesto do segundo projeto');
  await assert.rejects(access(join(secondProjectRoot, 'assets/manifest.json')), 'Um projeto novo não deve herdar assets importados em outro projeto.');
  await assert.rejects(access(join(secondProjectRoot, `assets/imported/${firstProjectAssetId}.png`)), 'Assets de um projeto não podem ser lidos/copiados para outro implicitamente.');
  assert.equal(JSON.parse(await readFile(join(secondProjectRoot, 'config/visual.json'), 'utf8')).elements['game.title'].base.text, 'Pedra, papel e tesoura', 'Projetos diferentes devem ter configurações independentes.');
  await session.evaluate(`([...document.querySelectorAll('button')].find((button) => button.innerText.trim() === 'Projetos')).click()`);
  await waitFor(() => session.evaluate(`document.querySelectorAll('.recent-project').length === 2`), 'lista de dois projetos recentes');
  await saveHomeScreenshot('Trindade-Studio-recentes.png');
  await session.evaluate(`([...document.querySelectorAll('.recent-project')].find((row) => row.innerText.includes('Projeto Central Um')).querySelector('.recent-open')).click()`);
  await waitFor(() => session.evaluate(`document.querySelector('.project-name')?.textContent === 'Projeto Central Um'`), 'abertura do projeto pelos recentes');
  assert.equal(await session.evaluate(`document.getElementById('property-game.title.text.base')?.value`), firstTitle, 'A abertura recente deve restaurar a configuração salva no projeto escolhido.');
  await session.evaluate(`(() => {
    const input = document.getElementById('property-game.title.text.base');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Título ainda não salvo');
    input.dispatchEvent(new Event('input', {bubbles:true}));
    input.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await session.evaluate(`([...document.querySelectorAll('button')].find((button) => button.innerText.trim() === 'Projetos')).click()`);
  await waitFor(() => session.evaluate(`Boolean(document.querySelector('.confirm-modal'))`), 'proteção ao retornar com alterações não salvas');
  await session.evaluate(`([...document.querySelectorAll('.modal-actions button')].find((button) => button.innerText.trim() === 'Cancelar')).click()`);
  assert.equal(await session.evaluate(`Boolean(document.querySelector('.project-name'))`), true, 'Cancelar a navegação deve manter o projeto e as alterações no editor.');
  await session.evaluate(`([...document.querySelectorAll('button')].find((button) => button.innerText.trim() === 'Projetos')).click()`);
  await waitFor(() => session.evaluate(`Boolean(document.querySelector('.confirm-modal'))`), 'segunda proteção de saída');
  await session.evaluate(`([...document.querySelectorAll('.modal-actions button')].find((button) => button.innerText.trim() === 'Descartar alterações')).click()`);
  await waitFor(() => session.evaluate(`Boolean(document.querySelector('.home-shell'))`), 'retorno à Central após descarte explícito');
  assert.equal(JSON.parse(await readFile(join(firstProjectRoot, 'config/visual.json'), 'utf8')).elements['game.title'].base.text, firstTitle, 'Descartar não deve gravar alterações.');
  await session.evaluate(`([...document.querySelectorAll('.recent-project')].find((row) => row.innerText.includes('Projeto Central Um')).querySelector('.recent-remove')).click()`);
  await waitFor(() => session.evaluate(`document.querySelectorAll('.recent-project').length === 1`), 'remoção da lista recente');
  await access(join(firstProjectRoot, 'index.html'));
  await session.evaluate(`document.querySelector('.update-check-button').click()`);
  await waitFor(() => session.evaluate(`!document.querySelector('.update-check-button').disabled && Boolean(document.querySelector('.update-status')?.innerText) && !document.querySelector('.update-status').innerText.includes('Verificando')`), 'retorno da consulta de versão', 12000);
  await saveHomeScreenshot('Trindade-Studio-atualizacoes.png');
  assert.deepEqual(session.consoleErrors, [], `Console da Central de Projetos: ${session.consoleErrors.join('; ')}`);
  report('criação de dois projetos, recentes, configurações independentes e retorno com alterações pendentes verificados');
  await session.evaluate('setTimeout(() => window.trindadeStudio.closeStudio(), 200); true');
  await waitFor(() => new Promise((resolvePromise) => child.exitCode !== null ? resolvePromise(true) : setTimeout(() => resolvePromise(false), 100)), 'fechamento normal da Central de Projetos');
  session.socket.close();
  session = null;

  const legacyFixture = join(temporary, 'legacy-schema-1-project');
  await mkdir(legacyFixture, { recursive: true });
  for (const relative of allowedFiles) {
    const destination = join(legacyFixture, relative);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(repositoryRoot, relative), destination);
  }
  const legacyCatalog = JSON.parse(await readFile(join(legacyFixture, 'config/editor-elements.schema.json'), 'utf8'));
  legacyCatalog.version = 1;
  legacyCatalog.elements = legacyCatalog.elements.filter((element) => !['menu.card', 'menu.start'].includes(element.id)).map(({ geometry, ...element }) => element);
  await writeFile(join(legacyFixture, 'config/editor-elements.schema.json'), `${JSON.stringify(legacyCatalog, null, 2)}\n`);
  const legacyConfig = JSON.parse(await readFile(join(legacyFixture, 'config/visual.json'), 'utf8'));
  legacyConfig.schemaVersion = 1;
  legacyConfig.elements = Object.fromEntries(Object.entries(legacyConfig.elements).filter(([id]) => legacyCatalog.elements.some((element) => element.id === id)));
  const legacyConfigPath = join(legacyFixture, 'config/visual.json');
  await writeFile(legacyConfigPath, `${JSON.stringify(legacyConfig, null, 2)}\n`);
  await copyFile(join(repositoryRoot, 'config/gameplay.local.json'), join(legacyFixture, 'config/gameplay.local.json'));
  const legacyConfigBefore = await readFile(legacyConfigPath);
  const legacyPort = await availablePort();
  const legacyProfile = join(temporary, 'legacy-project-profile');
  await mkdir(legacyProfile, { recursive: true });
  ({ child } = await launch(executable, legacyProfile, legacyFixture, legacyPort));
  session = await attach((await (await fetch(`http://127.0.0.1:${legacyPort}/json/list`)).json()).find((target) => target.type === 'page'));
  await waitFor(() => session.evaluate(`document.querySelector('.project-name')?.textContent === 'legacy-schema-1-project'`), 'abertura real de projeto schema 1');
  await waitFor(() => session.evaluate(`document.querySelectorAll('.layer-item[role="option"]').length === 1`), 'camadas compatíveis com o catálogo antigo');
  assert.equal(await session.evaluate(`Boolean(document.querySelector('.geometry-fields'))`), false, 'Projeto schema 1 sem registro de geometria não deve receber novas propriedades automaticamente.');
  const legacyFrameId = await waitFor(async () => {
    const { frameTree } = await session.send('Page.getFrameTree');
    return frameTree.childFrames?.find((frame) => new URL(frame.frame.url).pathname === '/')?.frame.id;
  }, 'frame da prévia schema 1');
  const legacyFrameContext = await waitFor(() => session.contexts.get(legacyFrameId), 'contexto da prévia schema 1');
  await session.evaluate(`document.querySelectorAll('.scene-item[role="option"]')[1].click()`);
  await waitFor(() => session.evaluate(`!document.querySelector('#game-screen').hidden`, legacyFrameContext), 'navegação de cena em projeto antigo');
  assert.deepEqual(await readFile(legacyConfigPath), legacyConfigBefore, 'Abrir e navegar no projeto não deve gravar nem migrar sua configuração.');
  assert.deepEqual(session.consoleErrors, [], `Console do projeto antigo: ${session.consoleErrors.join('; ')}`);
  report('projeto schema 1 aberto e navegado sem migração ou gravação silenciosa');
  await session.evaluate('setTimeout(() => window.trindadeStudio.closeStudio(), 200); true');
  await waitFor(() => new Promise((resolvePromise) => child.exitCode !== null ? resolvePromise(true) : setTimeout(() => resolvePromise(false), 100)), 'fechamento do teste schema 1');
  session.socket.close();
  session = null;
  process.stdout.write(`Studio Windows smoke: editor, oito cenas, partida, salvamento/backup, Central de Projetos, criação, recentes e independência de projetos aprovados. Captura: ${screenshotPath}\n`);
} finally {
  try { session?.socket.close(); } catch {}
  if (child && child.exitCode === null) {
    taskkillTree(child.pid);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  if (ownsTemporary) await rm(temporary, { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
}
