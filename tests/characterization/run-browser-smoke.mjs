import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const electronPath = process.env.TRINDADE_BROWSER || join(projectRoot, 'studio', 'node_modules', 'electron', 'dist', 'electron.exe');
const baseUrl = process.env.TRINDADE_BASE_URL || 'http://127.0.0.1:4173';
const baselineUrl = process.env.TRINDADE_BASELINE_URL || baseUrl;
const screenshotsRoot = join(projectRoot, 'studio', 'release', 'visual-comparison');
await access(electronPath);

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(check, description, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timeout aguardando ${description}${lastError ? `: ${lastError.message}` : ''}`);
}

async function runViewport(viewport) {
  const port = await availablePort();
  const profile = await mkdtemp(join(tmpdir(), 'trindade-browser-test-'));
  const harness = join(profile, 'browser-harness');
  await mkdir(harness, { recursive: true });
  await writeFile(join(harness, 'package.json'), JSON.stringify({ name: 'trindade-browser-harness', version: '1.0.0', main: 'main.cjs' }));
  await writeFile(join(harness, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron');
    app.setPath('userData', process.env.TRINDADE_BROWSER_PROFILE);
    app.commandLine.appendSwitch('remote-debugging-port', process.env.TRINDADE_BROWSER_PORT);
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: true, width: 1366, height: 768, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
      await window.loadURL('about:blank');
    });
  `);
  const browser = spawn(electronPath, [harness, `--user-data-dir=${join(profile, 'chromium')}`], {
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, TRINDADE_BROWSER_PORT: String(port), TRINDADE_BROWSER_PROFILE: join(profile, 'user-data') },
  });
  let socket;
  const consoleErrors = [];
  const requestFailures = [];
  try {
    const version = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      return response.ok ? response.json() : null;
    }, 'endpoint de depuração do Chromium isolado');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((target) => target.type === 'page');
    assert.ok(page?.webSocketDebuggerUrl, 'A aba do jogo não foi criada.');
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });

    let nextId = 1;
    const pending = new Map();
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') consoleErrors.push(message.params.args.map((arg) => arg.value || arg.description || '').join(' '));
      if (message.method === 'Runtime.bindingCalled' && message.params.name === '__trindadeCapture') {
        const filename = String(message.params.payload).replaceAll(':', '-');
        void (async () => {
          try {
            const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
            await mkdir(screenshotsRoot, { recursive: true });
            await writeFile(join(screenshotsRoot, `${filename}.png`), Buffer.from(capture.data, 'base64'));
          } catch (error) {
            process.stderr.write(`Falha na captura ${filename}: ${error.message}\n`);
          }
        })();
      }
      if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails.text);
      if (message.method === 'Network.loadingFailed') requestFailures.push(message.params.errorText);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject, timer } = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(timer);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result || {});
      }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timeout CDP: ${method}`));
      }, 15000);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result?.value;
    };

    await send('Runtime.enable');
    await send('Network.enable');
    await send('Page.enable');
    await send('Runtime.addBinding', { name: '__trindadeCapture' });
    await send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      Math.random = () => 0;
      Object.defineProperty(window, '__testNow', { value: 1000, writable: true });
      Object.defineProperty(Performance.prototype, 'now', { value: () => window.__testNow });
      const originalMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query) => query === '(prefers-reduced-motion: reduce)'
        ? { matches: true, media: query, addEventListener() {}, removeEventListener() {} }
        : originalMatchMedia(query);
      Object.defineProperty(window, '__animationIds', { value: [], writable: false });
      Object.defineProperty(window, '__gameAnimations', { value: [], writable: false });
      document.addEventListener('DOMContentLoaded', () => {
        const stabilizationStyles = document.createElement('style');
        stabilizationStyles.textContent = '*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}';
        document.documentElement.append(stabilizationStyles);
      }, { once: true });
      const nativeAnimate = Element.prototype.animate;
      Element.prototype.animate = function(...args) {
        const animation = nativeAnimate.apply(this, args);
        window.__gameAnimations.push(animation);
        animation.addEventListener('finish', () => window.__animationIds.push(animation.id));
        return animation;
      };
    ` });

    const scenarios = [];
    for (const [label, url] of [['baseline', `${baselineUrl}/Jogar-Trindade-transicao-preta.html`], ['modular', `${baseUrl}/`]]) {
      await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__captureTrindade = (scene) => {
        const locked = scene.startsWith('animacao-') ? window.__gameAnimations.filter((animation) => animation.playState === 'running') : [];
        for (const animation of locked) { animation.pause(); animation.currentTime = 75; }
        window.__trindadeCapture('${label}:${viewport.width}x${viewport.height}:' + scene);
        return new Promise((resolve) => setTimeout(() => { for (const animation of locked) animation.play(); resolve(); }, 800));
      };` });
      const loaded = new Promise((resolve) => socket.addEventListener('message', function onMessage(event) {
        const message = JSON.parse(event.data);
        if (message.method === 'Page.loadEventFired') {
          socket.removeEventListener('message', onMessage);
          resolve();
        }
      }));
      await send('Page.navigate', { url });
      await loaded;
      await evaluate(`window.__captureTrindade('menu')`);
      if (label === 'modular') {
        const configuredValues = await evaluate(`(async () => {
          const deadline = Date.now() + 10000;
          while (!document.querySelector('[data-editor-id="arena.background"]').style.getPropertyValue('--arena-background') && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          return {
            title: document.querySelector('[data-editor-id="game.title"]').textContent,
            arenaVariable: document.querySelector('[data-editor-id="arena.background"]').style.getPropertyValue('--arena-background'),
            playerHand: document.querySelector('[data-editor-id="hands.player.image"]').getAttribute('src'),
            enemyHand: document.querySelector('[data-editor-id="hands.enemy.image"]').getAttribute('src'),
            playerHealthColor: document.querySelector('[data-editor-id="hud.player.health"] > div').style.backgroundColor,
            enemyHealthColor: document.querySelector('[data-editor-id="hud.enemy.health"] > div').style.backgroundColor,
            moveButtonColor: document.querySelector('[data-editor-id="controls.move.rock"]').style.getPropertyValue('--move-button-background')
          };
        })()`);
        assert.deepEqual(configuredValues, {
          title: 'Pedra, papel e tesoura',
          arenaVariable: '#fafaf7',
          playerHand: './assets/images/hand-rock.png',
          enemyHand: './assets/images/hand-rock.png',
          playerHealthColor: 'rgb(99, 135, 115)',
          enemyHealthColor: 'rgb(184, 113, 101)',
          moveButtonColor: '#fafaf7',
        }, 'O catálogo/configuração visual não foi aplicado aos nove elementos na entrada modular.');
      }
      const result = await evaluate(`(async () => {
        const wait = async (predicate, label) => {
          const end = Date.now() + 10000;
          while (Date.now() < end) {
            if (predicate()) return;
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          throw new Error('Timeout: ' + label);
        };
        const read = () => ({
          menuHidden: document.querySelector('#menu-screen').hidden,
          gameVisible: !document.querySelector('#game-screen').hidden,
          playerHp: document.querySelector('#player-hp').textContent,
          enemyHp: document.querySelector('#enemy-hp').textContent,
          playerFill: document.querySelector('#player-fill').style.width,
          enemyFill: document.querySelector('#enemy-fill').style.width,
          score: [document.querySelector('#player-points').textContent, document.querySelector('#enemy-points').textContent],
          misses: document.querySelector('#missed-count').textContent,
          timer: document.querySelector('#time-left').textContent,
          turnStatus: document.querySelector('#turn-status').textContent,
          message: document.querySelector('#message').textContent,
          endVisible: !document.querySelector('#end-screen').hidden,
          selected: [...document.querySelectorAll('[data-sign]')].find((button) => button.classList.contains('selected'))?.dataset.sign || null,
          healText: document.querySelector('#use-heal').textContent.replace(/\\s+/g, ' ').trim(),
          healDisabled: document.querySelector('#use-heal').disabled,
          overflowX: document.documentElement.scrollWidth > innerWidth,
          testNow: window.__testNow,
          performanceNow: performance.now(),
        });
        const checks = [];
        const expect = (name, condition) => { if (!condition) throw new Error('Falha UI: ' + name); checks.push(name); };
        await wait(() => typeof document.querySelector('#start-game').onclick === 'function', 'UI inicializada');
        document.querySelector('#start-game').click();
        await wait(() => document.querySelector('#menu-screen').hidden && !document.querySelector('#game-screen').hidden, 'início do jogo');
        await wait(() => read().turnStatus === 'Sua vez' && read().timer === '5', 'timer pronto após a transição do menu');
        await window.__captureTrindade('combate-inicial');
        expect('início e timer de cinco segundos', read().timer === '5');
        expect('sem rolagem horizontal no viewport', !read().overflowX);

        document.querySelector('[data-sign="rock"]').click();
        await new Promise((resolve) => setTimeout(resolve, 75));
        await window.__captureTrindade('animacao-empate');
        await wait(() => read().message.includes('Empate') && read().turnStatus === 'Sua vez', 'jogada empatada');
        expect('empate sem dano', read().playerHp === '100 / 100' && read().enemyHp === '100 / 100');

        document.querySelector('[data-sign="paper"]').click();
        await new Promise((resolve) => setTimeout(resolve, 75));
        await window.__captureTrindade('animacao-ataque');
        await wait(() => read().enemyHp === '80 / 100' && read().turnStatus === 'Sua vez', 'jogada vencedora');
        await window.__captureTrindade('combate-apos-ataque');
        expect('vitória, dano e barra de vida', read().enemyFill === '80%' && read().selected === 'paper');
        expect('animações de avanço, recuo e recuperação são chamadas', ['advance', 'recoil', 'recover'].every((id) => window.__animationIds.includes(id)));
        expect('animação de empate em ambas as mãos', ['draw-player', 'draw-enemy'].every((id) => window.__animationIds.includes(id)));
        await wait(() => getComputedStyle(document.querySelector('[data-sign="paper"]')).backgroundColor === 'rgb(230, 237, 226)', 'cor do botão selecionado');
        expect('cor do botão selecionado', true);

        document.querySelector('#restart').click();
        await wait(() => read().enemyHp === '100 / 100' && read().score[0] === '0' && read().selected === null && read().turnStatus === 'Sua vez', 'reinício');
        expect('reinício restaura vida, placar e seleção', true);

        for (let battle = 1; battle <= 3; battle++) {
          for (let turn = 1; turn <= 5; turn++) {
            document.querySelector('[data-sign="paper"]').click();
            if (turn < 5) await wait(() => read().enemyHp === (100 - turn * 20) + ' / 100' && read().turnStatus === 'Sua vez', 'dano ' + battle + '.' + turn);
          }
          await wait(() => read().endVisible, 'fim do combate ' + battle);
          if (battle === 3) {
            document.querySelector('#enemy-speech').hidden = true;
            document.activeElement?.blur();
            await window.__captureTrindade('resultado-final');
          }
          if (battle < 3) {
            document.querySelector('#again').click();
            await wait(() => !read().endVisible && read().enemyHp === '100 / 100' && read().turnStatus === 'Sua vez', 'próximo combate ' + (battle + 1));
          }
        }
        expect('prêmio no terceiro ponto', document.querySelector('#end-summary').textContent.includes('Luck Block: Cura'));
        document.querySelector('#again').click();
        await wait(() => !read().endVisible && read().enemyHp === '100 / 100', 'avanço após prêmio');
        document.querySelector('[data-sign="scissors"]').click();
        await wait(() => read().playerHp === '80 / 100' && read().turnStatus === 'Sua vez', 'dano recebido');
        expect('cura disponível após dano', !read().healDisabled && read().healText.includes('1'));
        document.querySelector('#enemy-speech').hidden = true;
        await window.__captureTrindade('poder-disponivel');
        document.querySelector('#use-heal').click();
        await wait(() => read().playerHp === '90 / 100' && read().healDisabled, 'uso de cura');
        expect('cura aplicada e consumida', read().playerFill === '90%' && read().healText.includes('0'));

        return { checks, final: read(), viewport: [innerWidth, innerHeight] };
      })()`);
      scenarios.push({ label, result });
    }
    assert.deepEqual(scenarios[0].result, scenarios[1].result, `Comportamento visual/UI diverge no viewport ${viewport.width}×${viewport.height}.`);
    assert.deepEqual(consoleErrors, [], `Console com erros em ${viewport.width}×${viewport.height}: ${consoleErrors.join('; ')}`);
    assert.deepEqual(requestFailures, [], `Falhas de rede em ${viewport.width}×${viewport.height}: ${requestFailures.join('; ')}`);
    return { viewport: `${viewport.width}×${viewport.height}`, checks: scenarios[0].result.checks.length, consoleErrors, requestFailures };
  } finally {
    if (socket?.readyState === WebSocket.OPEN) {
      try { await new Promise((resolve) => { socket.addEventListener('close', resolve, { once: true }); socket.send(JSON.stringify({ id: 999999, method: 'Browser.close' })); setTimeout(resolve, 1500); }); } catch {}
    }
    if (process.platform === 'win32') {
      // Killing the spawned launcher alone can leave Electron child processes
      // holding Chromium profile files open on Windows. Scope taskkill to this
      // test's exact process tree rather than stopping all Electron instances.
      try { execFileSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    } else if (browser.exitCode === null) {
      const exited = new Promise((resolve) => browser.once('exit', resolve));
      browser.kill();
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1500))]);
    }
    // Windows may briefly retain Chromium's SQLite WAL handles after Browser.close.
    // Keep cleanup deterministic, but allow the OS a longer interval before failing.
    for (let attempt = 0; attempt < 30; attempt++) {
      try { await rm(profile, { recursive: true, force: true }); break; }
      catch (error) {
        if (attempt === 29 || error.code !== 'EBUSY') throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
}

const results = [];
for (const viewport of [{ width: 1366, height: 768, mobile: false }, { width: 390, height: 844, mobile: true }]) results.push(await runViewport(viewport));
process.stdout.write(`Browser UI characterization: ${results.reduce((sum, result) => sum + result.checks, 0)} checks baseline↔modular, ${results.map((result) => result.viewport).join(', ')}; zero console errors and network failures\n`);
