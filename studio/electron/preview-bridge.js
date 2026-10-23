(() => {
  const scriptSource = document.currentScript?.src;
  const query = new URL(scriptSource || location.href).searchParams;
  const parentOrigin = query.get('studioParent');
  const session = query.get('studioSession');
  const protocol = 1;
  const validId = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;
  let mode = query.get('studioMode') === 'test' ? 'test' : 'edit';
  let selectedId = null;
  let catalog = null;
  let scenes = null;
  let activeScene = null;
  let applyConfig = null;
  let refreshAssets = null;
  let currentConfig = null;
  let geometryBreakpoint = 'desktop';
  let visualBreakpointOverride = null;
  let dragState = null;
  let overlay = null;
  let overlayFrame = 0;
  let isReady = false;

  function post(type, detail = {}) {
    if (!parentOrigin || !session || window.parent === window) return;
    window.parent.postMessage({ protocol, session, type, ...detail }, parentOrigin);
  }

  function showSelection() {
    document.querySelectorAll('[data-trindade-studio-selected]').forEach((element) => {
      element.removeAttribute('data-trindade-studio-selected');
    });
    if (!selectedId || !validId.test(selectedId) || !activeScene?.elementIds.includes(selectedId)) { updateOverlay(); return; }
    const target = document.querySelector(`[data-editor-id="${selectedId}"]`);
    if (target && isVisible(target)) {
      target.setAttribute('data-trindade-studio-selected', 'true');
      const rect = target.getBoundingClientRect();
      post('ELEMENT_METRICS', { id: selectedId, width: rect.width, height: rect.height });
    }
    updateOverlay();
  }

  function isVisible(element) {
    if (!element || element.closest('[hidden]')) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  }

  function geometryDefinition(id) { return catalog?.elements.find((element) => element.id === id)?.geometry || null; }
  function geometryValues(id) {
    const definition = geometryDefinition(id);
    const entry = currentConfig?.elements?.[id]?.geometry;
    if (!definition || !entry) return { ...definition?.default };
    const values = { ...definition.default, ...(entry.base || {}) };
    if (geometryBreakpoint !== 'desktop') Object.assign(values, entry.responsive?.[geometryBreakpoint] || {});
    return values;
  }
  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'trindade-geometry-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    for (const handle of ['nw', 'ne', 'sw', 'se']) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `trindade-geometry-handle handle-${handle}`;
      button.dataset.resize = handle;
      button.tabIndex = -1;
      overlay.append(button);
    }
    document.body.append(overlay);
    return overlay;
  }
  function updateOverlay() {
    if (overlayFrame) return;
    overlayFrame = requestAnimationFrame(() => {
      overlayFrame = 0;
      const definition = geometryDefinition(selectedId);
      const target = selectedId ? document.querySelector(`[data-editor-id="${selectedId}"]`) : null;
      if (mode !== 'edit' || !definition || !target || !isVisible(target) || !activeScene?.elementIds.includes(selectedId)) {
        overlay?.setAttribute('hidden', '');
        return;
      }
      const rect = target.getBoundingClientRect();
      const frame = ensureOverlay();
      frame.removeAttribute('hidden');
      frame.style.left = `${rect.left + window.scrollX}px`;
      frame.style.top = `${rect.top + window.scrollY}px`;
      frame.style.width = `${rect.width}px`;
      frame.style.height = `${rect.height}px`;
      frame.querySelectorAll('[data-resize]').forEach((handle) => { handle.hidden = !definition.supports.includes('resize'); });
    });
  }
  window.addEventListener('resize', updateOverlay, { passive: true });
  window.addEventListener('scroll', updateOverlay, { passive: true });
  const overlayResizeObserver = new ResizeObserver(updateOverlay);
  overlayResizeObserver.observe(document.documentElement);
  function applyGeometryToTarget(id, values) {
    const target = document.querySelector(`[data-editor-id="${id}"]`);
    if (!target) return;
    target.dataset.trindadeGeometry = 'flow-box';
    for (const field of ['x', 'y', 'width', 'height']) {
      if (values[field] !== undefined) target.style.setProperty(`--studio-geometry-${field}`, `${values[field]}px`);
    }
    updateOverlay();
  }
  function beginGeometryDrag(event, target, resizeHandle = null) {
    const id = target.getAttribute('data-editor-id');
    const definition = geometryDefinition(id);
    if (mode !== 'edit' || !definition || !isVisible(target)) return false;
    if (resizeHandle ? !definition.supports.includes('resize') : !definition.supports.includes('move')) return false;
    const rect = target.getBoundingClientRect();
    const values = geometryValues(id);
    dragState = { id, target, handle: resizeHandle, startX: event.clientX, startY: event.clientY, values, rect, changed: false };
    target.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }

  document.addEventListener('pointerdown', (event) => {
    if (mode !== 'edit') return;
    const handle = event.composedPath().find((item) => item instanceof Element && item.hasAttribute('data-resize'));
    if (handle && selectedId) {
      const target = document.querySelector(`[data-editor-id="${selectedId}"]`);
      if (target) beginGeometryDrag(event, target, handle.dataset.resize);
      return;
    }
    const target = event.composedPath().find((item) => item instanceof Element && item.hasAttribute('data-editor-id'));
    if (target) {
      const id = target.getAttribute('data-editor-id');
      if (!id || !validId.test(id) || !catalog?.elements.some((entry) => entry.id === id) || !activeScene?.elementIds.includes(id) || !isVisible(target)) return;
      selectedId = id;
      showSelection();
      post('ELEMENT_SELECTED', { id });
      if (beginGeometryDrag(event, target)) return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener('pointermove', (event) => {
    if (!dragState) return;
    const { id, target, values, rect, startX, startY, handle } = dragState;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    const definition = geometryDefinition(id);
    const next = { ...values };
    if (handle) {
      if (handle.includes('e')) next.width = Math.max(definition.limits.width.min, Math.min(definition.limits.width.max, rect.width + dx));
      if (handle.includes('s')) next.height = Math.max(definition.limits.height.min, Math.min(definition.limits.height.max, rect.height + dy));
      if (handle.includes('w')) {
        next.width = Math.max(definition.limits.width.min, Math.min(definition.limits.width.max, rect.width - dx));
        next.x = Math.max(definition.limits.x.min, Math.min(definition.limits.x.max, values.x + dx));
      }
      if (handle.includes('n')) {
        next.height = Math.max(definition.limits.height.min, Math.min(definition.limits.height.max, rect.height - dy));
        next.y = Math.max(definition.limits.y.min, Math.min(definition.limits.y.max, values.y + dy));
      }
    } else {
      next.x = Math.max(definition.limits.x.min, Math.min(definition.limits.x.max, values.x + dx));
      next.y = Math.max(definition.limits.y.min, Math.min(definition.limits.y.max, values.y + dy));
    }
    dragState.changed = true;
    applyGeometryToTarget(id, next);
    event.preventDefault();
  }, true);

  document.addEventListener('pointerup', () => {
    if (!dragState) return;
    const { id, changed } = dragState;
    dragState = null;
    if (changed) {
      const values = geometryValues(id);
      const target = document.querySelector(`[data-editor-id="${id}"]`);
      for (const field of ['x', 'y', 'width', 'height']) {
        const value = Number.parseFloat(target?.style.getPropertyValue(`--studio-geometry-${field}`));
        if (Number.isFinite(value)) values[field] = value;
      }
      post('GEOMETRY_CHANGED', { id, breakpoint: geometryBreakpoint, values });
    }
  }, true);

  document.addEventListener('click', (event) => {
    if (mode !== 'edit') return;
    const target = event.composedPath().find((item) => item instanceof Element && item.hasAttribute('data-editor-id'));
    if (target) {
      const id = target.getAttribute('data-editor-id');
      if (id && validId.test(id) && catalog?.elements.some((entry) => entry.id === id) && activeScene?.elementIds.includes(id) && isVisible(target)) {
        selectedId = id;
        showSelection();
        post('ELEMENT_SELECTED', { id });
      }
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  const signs = Object.freeze({ rock: './assets/images/hand-rock.png', paper: './assets/images/hand-paper.png', scissors: './assets/images/hand-scissors.png' });
  const powerNames = Object.freeze({ heal: 'Cura', defense: 'Defesa', critical: 'Crítico' });

  function setValue(id, value) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Alvo de demonstração ausente: ${id}`);
    element.textContent = String(value);
  }

  function setHealth(side, value) {
    setValue(`${side}-hp`, `${value} / 100`);
    const fill = document.getElementById(`${side}-fill`);
    const track = document.getElementById(`${side}-health`);
    fill.style.width = `${value}%`;
    track.setAttribute('aria-valuenow', String(value));
  }

  function setPowerCount(side, kind, count) {
    const element = document.getElementById(side === 'player' ? `use-${kind}` : `enemy-${kind}`);
    if (!element) throw new Error('Indicador de poder de demonstração ausente.');
    if (side === 'player') {
      element.querySelector('.orb-name').textContent = powerNames[kind];
      element.querySelector('strong').textContent = String(count);
      element.querySelector('em').textContent = { heal: 'H', defense: 'D', critical: 'C' }[kind];
      element.classList.toggle('ready', count > 0);
    } else {
      element.querySelector('.orb-name').textContent = powerNames[kind];
      element.querySelector('strong').textContent = String(count);
    }
  }

  function applyScene(id) {
    if (mode !== 'edit') return;
    const scene = scenes?.scenes.find((entry) => entry.id === id);
    if (!scene) return;
    if (!Array.isArray(scene.elementIds)) throw new Error('A cena possui uma lista de elementos inválida.');
    // Projetos antigos podem usar um catálogo anterior ao da cena global do Studio.
    // Filtramos somente os elementos não registrados, sem alterar ou migrar o projeto.
    const compatibleElementIds = scene.elementIds.filter((elementId) => catalog?.elements.some((entry) => entry.id === elementId));
    activeScene = { ...scene, elementIds: compatibleElementIds };
    const menu = scene.fixture.kind === 'menu';
    document.getElementById('menu-screen').hidden = !menu;
    document.getElementById('game-screen').hidden = menu;
    document.getElementById('transition-curtain').hidden = true;
    document.getElementById('enemy-speech').hidden = true;
    document.getElementById('end-screen').hidden = true;
    document.getElementById('player').className = 'hand';
    document.getElementById('enemy').className = 'hand';
    document.getElementById('message').className = '';
    selectedId = compatibleElementIds[0] || null;

    if (!menu) {
      const fixture = scene.fixture;
      setValue('player-points', fixture.playerPoints);
      setValue('enemy-points', fixture.enemyPoints);
      setValue('battle-number', fixture.battle);
      setValue('missed-count', `${fixture.misses} / 3 faltas`);
      setValue('player-power-progress', `${fixture.power === 'heal' ? 1 : 0} efeito${fixture.power === 'heal' ? '' : 's'} guardado${fixture.power === 'heal' ? '' : 's'} · próximo bloco em ${3 - (fixture.playerPoints % 3)} vitórias`);
      setValue('enemy-power-progress', `0 efeitos guardados · próximo bloco em ${3 - (fixture.enemyPoints % 3)} vitórias`);
      setValue('active-buff', 'Efeitos não usados passam ao vencedor do combate.');
      setHealth('player', fixture.playerHp);
      setHealth('enemy', fixture.enemyHp);
      document.getElementById('player-hand').src = signs[fixture.playerSign];
      document.getElementById('enemy-hand').src = signs[fixture.enemySign];
      document.getElementById('player-hand').alt = `Sua mão: ${{ rock: 'pedra', paper: 'papel', scissors: 'tesoura' }[fixture.playerSign]}`;
      document.getElementById('enemy-hand').alt = 'Mão do inimigo';
      document.querySelectorAll('[data-sign]').forEach((button) => button.classList.toggle('selected', button.dataset.sign === fixture.playerSign));
      document.getElementById('time-left').textContent = fixture.kind === 'match-result' ? '0' : '5';
      document.getElementById('turn-status').textContent = fixture.kind === 'match-result' ? 'Fim' : 'Combate';
      document.getElementById('timer-dial').setAttribute('aria-valuenow', fixture.kind === 'match-result' ? '0' : '5');
      for (const kind of ['heal', 'defense', 'critical']) setPowerCount('player', kind, fixture.power === kind ? 1 : 0);
      for (const kind of ['heal', 'defense', 'critical']) setPowerCount('enemy', kind, 0);
      document.getElementById('message').textContent = fixture.kind === 'combat' ? 'Escolha sua jogada antes que os 5 segundos acabem.' : 'Demonstração do estado real do jogo.';
      if (fixture.kind !== 'combat') {
        const ending = document.getElementById('end-screen');
        const playerWon = fixture.winner === 'player';
        const finished = fixture.kind === 'match-result';
        document.getElementById('end-title').textContent = finished
          ? playerWon ? 'Você venceu a partida!' : 'O inimigo venceu a partida!'
          : playerWon ? 'Você venceu o combate!' : 'O inimigo venceu o combate!';
        document.getElementById('end-summary').textContent = finished
          ? fixture.reason === 'timeout'
            ? `Você deixou o tempo acabar 3 vezes e perdeu por inatividade. Placar final: ${fixture.playerPoints} × ${fixture.enemyPoints}.`
            : `${playerWon ? 'Você' : 'O inimigo'} chegou a 10 pontos! Placar final: ${fixture.playerPoints} × ${fixture.enemyPoints}.`
          : `${playerWon ? 'Você' : 'O inimigo'} ganhou 1 ponto. Placar: ${fixture.playerPoints} × ${fixture.enemyPoints}.${fixture.power ? ` Luck Block: ${powerNames[fixture.power]}!` : ''}`;
        document.getElementById('again').textContent = finished ? 'Jogar novamente' : 'Próximo combate';
        ending.hidden = false;
      }
    }
    showSelection();
    post('SCENE_APPLIED', { id: scene.id, elementIds: compatibleElementIds });
  }

  function waitForGameUi() {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 10000;
      const check = () => {
        const startButton = document.getElementById('start-game');
        const powerButton = document.querySelector('#use-heal .orb-name');
        if (typeof startButton?.onclick === 'function' && powerButton) return resolve();
        if (Date.now() >= deadline) return reject(new Error('A interface do jogo não concluiu a inicialização.'));
        setTimeout(check, 25);
      };
      check();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (mode !== 'edit') return;
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  window.addEventListener('message', async (event) => {
    const message = event.data;
    if (event.origin !== parentOrigin || event.source !== window.parent || !message || typeof message !== 'object') return;
    if (message.protocol !== protocol || message.session !== session) return;
    if (message.type === 'HELLO' && isReady) {
      post('PREVIEW_READY');
      return;
    }
    if (message.type === 'SET_MODE') {
      if (message.mode !== 'edit' && message.mode !== 'test') return;
      mode = message.mode;
      document.documentElement.dataset.studioMode = mode;
      if (catalog && currentConfig && applyConfig) {
        applyConfig(catalog, currentConfig, document, mode === 'edit' ? visualBreakpointOverride : null);
      }
      updateOverlay();
      post('MODE_CHANGED', { mode });
      return;
    }
    if (message.type === 'SET_SELECTION') {
      if (message.id !== null && (typeof message.id !== 'string' || !validId.test(message.id) || !catalog?.elements.some((entry) => entry.id === message.id) || !activeScene?.elementIds.includes(message.id))) return;
      selectedId = message.id;
      showSelection();
      return;
    }
    if (message.type === 'SET_DEVICE') {
      if (message.device !== 'desktop' && message.device !== 'mobile') return;
      geometryBreakpoint = message.device === 'mobile' ? 'mobile' : 'desktop';
      visualBreakpointOverride = message.device;
      if (catalog && currentConfig && applyConfig) {
        applyConfig(catalog, currentConfig, document, mode === 'edit' ? visualBreakpointOverride : null);
      }
      if (selectedId) applyGeometryToTarget(selectedId, geometryValues(selectedId));
      updateOverlay();
      return;
    }
    if (message.type === 'ALIGN_SELECTION' && selectedId && ['horizontal', 'vertical'].includes(message.axis)) {
      const target = document.querySelector(`[data-editor-id="${selectedId}"]`);
      const definition = geometryDefinition(selectedId);
      if (!target || !definition || !isVisible(target)) return;
      const parent = target.parentElement;
      if (!parent) return;
      const targetRect = target.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      const values = geometryValues(selectedId);
      if (message.axis === 'horizontal') values.x = Math.max(definition.limits.x.min, Math.min(definition.limits.x.max, values.x + parentRect.left + parentRect.width / 2 - targetRect.left - targetRect.width / 2));
      else values.y = Math.max(definition.limits.y.min, Math.min(definition.limits.y.max, values.y + parentRect.top + parentRect.height / 2 - targetRect.top - targetRect.height / 2));
      post('GEOMETRY_CHANGED', { id: selectedId, breakpoint: geometryBreakpoint, values });
      return;
    }
    if (message.type === 'SET_SCENE' && typeof message.id === 'string') {
      try { applyScene(message.id); }
      catch (error) { post('PREVIEW_ERROR', { message: error instanceof Error ? error.message : 'Não foi possível mostrar esse estado.' }); }
      return;
    }
    if (message.type === 'APPLY_CONFIG') {
      try {
        if (!catalog || !applyConfig) throw new Error('A prévia ainda está carregando o catálogo.');
        currentConfig = message.config;
        applyConfig(catalog, message.config, document, mode === 'edit' ? visualBreakpointOverride : null);
        updateOverlay();
        post('CONFIG_APPLIED');
      } catch (error) {
        post('PREVIEW_ERROR', { message: error instanceof Error ? error.message : 'Não foi possível aplicar a prévia.' });
      }
      return;
    }
    if (message.type === 'ASSETS_UPDATED') {
      try {
        if (!refreshAssets || !catalog || !applyConfig) throw new Error('A biblioteca de imagens ainda está carregando.');
        await refreshAssets();
        if (currentConfig) applyConfig(catalog, currentConfig, document, mode === 'edit' ? visualBreakpointOverride : null);
        updateOverlay();
        post('ASSETS_APPLIED');
      } catch (error) {
        post('PREVIEW_ERROR', { message: error instanceof Error ? error.message : 'Não foi possível atualizar a biblioteca de imagens.' });
      }
    }
  });

  const style = document.createElement('style');
  style.textContent = '[data-trindade-studio-selected="true"]{outline:2px solid #596eea!important;outline-offset:2px!important}.trindade-geometry-overlay{position:absolute;z-index:2147483000;border:2px solid #596eea;box-sizing:border-box;pointer-events:none}.trindade-geometry-overlay[hidden]{display:none!important}.trindade-geometry-handle{position:absolute;width:12px;height:12px;padding:0;border:2px solid white;border-radius:50%;background:#596eea;box-shadow:0 1px 5px #2228;pointer-events:auto;cursor:nwse-resize}.handle-nw{left:-7px;top:-7px}.handle-ne{right:-7px;top:-7px}.handle-sw{left:-7px;bottom:-7px}.handle-se{right:-7px;bottom:-7px}[data-studio-mode="edit"]{cursor:crosshair!important}';
  document.head.append(style);

  Promise.all([
    fetch('/config/editor-elements.schema.json').then((response) => {
      if (!response.ok) throw new Error('Catálogo indisponível na prévia.');
      return response.json();
    }),
    fetch(`/__studio/scenes.json?${new URLSearchParams({ studioParent: parentOrigin || '', studioSession: session || '' })}`).then((response) => {
      if (!response.ok) throw new Error('Catálogo de telas indisponível na prévia.');
      return response.json();
    }),
    import('/src/game/ui/visual-config.js'),
  ]).then(([loadedCatalog, loadedScenes, visualConfig]) => {
    catalog = loadedCatalog;
    scenes = loadedScenes;
    applyConfig = visualConfig.applyVisualConfiguration;
    refreshAssets = visualConfig.refreshProjectAssets;
    return waitForGameUi().then(() => {
      isReady = true;
      document.documentElement.dataset.studioMode = mode;
      post('PREVIEW_READY');
    });
  }).catch((error) => post('PREVIEW_ERROR', { message: error instanceof Error ? error.message : 'Falha ao inicializar a prévia.' }));
})();
