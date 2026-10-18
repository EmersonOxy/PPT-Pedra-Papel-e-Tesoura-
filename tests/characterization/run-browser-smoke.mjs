import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const edgePath = process.env.TRINDADE_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const baseUrl = process.env.TRINDADE_BASE_URL || 'http://127.0.0.1:4173';
const baselineUrl = process.env.TRINDADE_BASELINE_URL || baseUrl;
await access(edgePath);

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
  const profile = await mkdtemp(join(tmpdir(), 'trindade-edge-'));
  const browser = spawn(edgePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--disable-background-mode',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  let socket;
  const consoleErrors = [];
  const requestFailures = [];
  try {
    const version = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      return response.ok ? response.json() : null;
    }, 'endpointo de depuração do Edge');
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
      if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails.text);
      if (message.method === 'Network.loadingFailed') requestFailures.push(message.params.errorText);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result || {});
      }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
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
      Element.prototype.animate = function() {
        const animation = { finished: Promise.resolve(), cancel() {} };
        Object.defineProperty(animation, 'id', { set(value) { window.__animationIds.push(value); } });
        return animation;
      };
    ` });

    const scenarios = [];
    for (const [label, url] of [['baseline', `${baselineUrl}/Jogar-Trindade-transicao-preta.html`], ['modular', `${baseUrl}/`]]) {
      const loaded = new Promise((resolve) => socket.addEventListener('message', function onMessage(event) {
        const message = JSON.parse(event.data);
        if (message.method === 'Page.loadEventFired') {
          socket.removeEventListener('message', onMessage);
          resolve();
        }
      }));
      await send('Page.navigate', { url });
      await loaded;
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
        expect('início e timer de cinco segundos', read().timer === '5');
        expect('sem rolagem horizontal no viewport', !read().overflowX);

        document.querySelector('[data-sign="rock"]').click();
        await wait(() => read().message.includes('Empate') && read().turnStatus === 'Sua vez', 'jogada empatada');
        expect('empate sem dano', read().playerHp === '100 / 100' && read().enemyHp === '100 / 100');

        document.querySelector('[data-sign="paper"]').click();
        await wait(() => read().enemyHp === '80 / 100' && read().turnStatus === 'Sua vez', 'jogada vencedora');
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
    if (browser.exitCode === null) {
      const exited = new Promise((resolve) => browser.once('exit', resolve));
      browser.kill();
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1500))]);
    }
    if (browser.exitCode === null && process.platform === 'win32') {
      try { execFileSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      try { await rm(profile, { recursive: true, force: true }); break; }
      catch (error) {
        if (attempt === 4 || error.code !== 'EBUSY') throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
}

const results = [];
for (const viewport of [{ width: 1366, height: 768, mobile: false }, { width: 390, height: 844, mobile: true }]) results.push(await runViewport(viewport));
process.stdout.write(`Browser UI characterization: ${results.reduce((sum, result) => sum + result.checks, 0)} checks baseline↔modular, ${results.map((result) => result.viewport).join(', ')}; zero console errors and network failures\n`);
