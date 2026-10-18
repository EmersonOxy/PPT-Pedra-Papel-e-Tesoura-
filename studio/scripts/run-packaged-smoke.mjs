import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const studioRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repositoryRoot = resolve(studioRoot, '..');
const packageRoot = join(studioRoot, 'release');
const executable = process.env.TRINDADE_STUDIO_TEST_EXE || join(packageRoot, 'win-unpacked', 'Trindade Studio.exe');
const screenshotPath = join(packageRoot, 'Trindade-Studio-proof.png');
const sceneScreenshotRoot = join(packageRoot, 'scene-browser');
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

function taskkillTree(pid) {
  if (process.platform === 'win32' && pid) {
    try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  }
}

async function launch(exe, profile, fixture, debugPort) {
  const child = spawn(exe, [`--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`], {
    windowsHide: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      TRINDADE_PROJECT_ROOT: fixture,
      TRINDADE_STUDIO_TEST_MODE: '1',
      TRINDADE_STUDIO_DEBUG_PORT: String(debugPort),
      TRINDADE_STUDIO_TEST_USER_DATA: join(profile, 'app-data'),
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
      canceled: message.params.canceled === true,
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
await access(executable);

let child;
let session;
try {
  const port = await availablePort();
  ({ child } = await launch(executable, profile, fixture, port));
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
    return state.scenes === 8 && state.project !== 'Nenhum projeto aberto' && state.layers > 0
      || state.body.includes('Não foi possível carregar') ? state : null;
  }, 'interface React e projeto em edição');
  assert.equal(studio.scenes, 8, `O navegador não apresentou as oito cenas cadastradas: ${JSON.stringify(studio)}`);
  assert.equal(studio.layers, 1, `O menu deve listar somente seu alvo editável: ${JSON.stringify(studio)}`);
  assert.match(studio.preview, /^http:\/\/127\.0\.0\.1:/, 'A prévia não usa servidor local isolado.');
  assert.deepEqual(studio.nodeAccess, ['undefined', 'undefined'], 'O renderer recebeu acesso Node inesperado.');
  assert.deepEqual(studio.api.sort(), ['closeStudio', 'getProject', 'onCloseRequest', 'onHistoryCommand', 'onOpenProjectRequest', 'onSaveRequest', 'openProject', 'respondToClose', 'saveVisualConfig', 'setDirty'].sort());
  report('renderer isolado, oito cenas e camada de menu verificados');

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

  await selectScene('combat', `!document.querySelector('#game-screen').hidden && document.querySelector('#end-screen').hidden`, 'retorno ao estado de combate');
  await session.evaluate(`document.querySelector('[data-editor-id="arena.background"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`, frameContext);
  await waitFor(() => session.evaluate(`document.querySelector('.selected-element-card')?.innerText.includes('arena.background')`), 'seleção do elemento de cor');
  await session.evaluate(`(() => {
    const input = document.getElementById('property-arena.background.backgroundColor');
    if (!(input instanceof HTMLInputElement)) throw new Error('Campo de cor ausente: ' + document.querySelector('.selected-element-card')?.innerText + ' / ' + [...document.querySelectorAll('[id^="property-"]')].map((item) => item.id).join(','));
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '#123456');
    input.dispatchEvent(new Event('input', {bubbles:true}));
    input.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="arena.background"]').style.getPropertyValue('--arena-background') === '#123456'`, frameContext), 'alteração de cor aplicada à prévia');

  await session.evaluate(`document.querySelector('[data-editor-id="controls.move.rock"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`, frameContext);
  await waitFor(() => session.evaluate(`document.querySelector('.selected-element-card')?.innerText.includes('controls.move.rock')`), 'seleção de controle com propriedade compartilhada');
  await session.evaluate(`(() => {
    const input = document.getElementById('property-controls.move.rock.backgroundColor');
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
    const input = document.getElementById('property-hands.player.image.assetId');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(input, 'hands.paper');
    input.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await waitFor(() => session.evaluate(`document.querySelector('[data-editor-id="hands.player.image"]').getAttribute('src') === './assets/images/hand-paper.png'`, frameContext), 'seleção de imagem permitida aplicada à prévia');
  report('edição de cor, imagem permitida e isolamento das propriedades compartilhadas verificados');

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
    const uiState = await session.evaluate(`({dirty:document.querySelector('.save-state').classList.contains('is-dirty'), asset:document.getElementById('property-hands.player.image.assetId')?.value})`);
    const previewAsset = await session.evaluate(`document.querySelector('[data-editor-id="hands.player.image"]').getAttribute('src')`, frameContext);
    const previewScene = await session.evaluate(`document.querySelector('#menu-screen').hidden && !document.querySelector('#game-screen').hidden && document.querySelector('#end-screen').hidden`, frameContext);
    editReturnState = { uiState, previewAsset, previewScene, previewMode: await session.evaluate(`document.documentElement.dataset.studioMode`, frameContext), previewErrors: session.consoleErrors.slice(-3) };
    return uiState.dirty && uiState.asset === 'hands.paper' && previewAsset === './assets/images/hand-paper.png' && previewScene;
  }, 'preservação das alterações não salvas ao retornar de Testar'); }
  catch (error) { throw new Error(`${error.message}; estado após retorno: ${JSON.stringify(editReturnState)}`); }
  await session.evaluate(`document.querySelector('button.save-button').click()`);
  await waitFor(() => readFile(join(fixture, 'config/visual.json'), 'utf8').then((raw) => JSON.parse(raw).elements['game.title'].base.text === newTitle), 'salvamento persistente');
  assert.equal(await readFile(join(fixture, 'config/visual.json.bak'), 'utf8').then((raw) => JSON.parse(raw).elements['game.title'].base.text), 'Pedra, papel e tesoura', 'O backup não preservou a configuração anterior.');
  report('configuração salva com backup');

  await session.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await session.evaluate(`document.querySelector('button[title="Visualização celular"]').click()`);
  assert.equal(await session.evaluate(`document.querySelector('.preview-frame-wrap').classList.contains('mobile-preview')`), true, 'A prévia celular não alterou o enquadramento.');
  await session.send('Emulation.clearDeviceMetricsOverride');
  await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }).then((result) => writeFile(screenshotPath, Buffer.from(result.data, 'base64')));
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
  assert.deepEqual(session.consoleErrors, [], `Console após reabrir: ${session.consoleErrors.join('; ')}`);
  await session.evaluate('setTimeout(() => window.trindadeStudio.closeStudio(), 200); true');
  await waitFor(() => new Promise((resolvePromise) => child.exitCode !== null ? resolvePromise(true) : setTimeout(() => resolvePromise(false), 100)), 'fechamento normal após reabertura');
  session.socket.close();
  session = null;
  process.stdout.write(`Studio Windows smoke: 9 elementos, seleção direta, prévia ao vivo, undo/redo, partida, modo teste, mobile, salvamento/backup e reabertura aprovados. Falhas de rede não canceladas: 0. Screenshot: ${screenshotPath}\n`);
} finally {
  try { session?.socket.close(); } catch {}
  if (child && child.exitCode === null) {
    taskkillTree(child.pid);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  if (ownsTemporary) await rm(temporary, { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
}
