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
  let isReady = false;

  function post(type, detail = {}) {
    if (!parentOrigin || !session || window.parent === window) return;
    window.parent.postMessage({ protocol, session, type, ...detail }, parentOrigin);
  }

  function showSelection() {
    document.querySelectorAll('[data-trindade-studio-selected]').forEach((element) => {
      element.removeAttribute('data-trindade-studio-selected');
    });
    if (!selectedId || !validId.test(selectedId) || !activeScene?.elementIds.includes(selectedId)) return;
    const target = document.querySelector(`[data-editor-id="${selectedId}"]`);
    if (target) target.setAttribute('data-trindade-studio-selected', 'true');
  }

  document.addEventListener('click', (event) => {
    if (mode !== 'edit') return;
    const target = event.composedPath().find((item) => item instanceof Element && item.hasAttribute('data-editor-id'));
    if (target) {
      const id = target.getAttribute('data-editor-id');
      if (id && validId.test(id) && catalog?.elements.some((entry) => entry.id === id) && activeScene?.elementIds.includes(id)) {
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
    if (!Array.isArray(scene.elementIds) || scene.elementIds.some((elementId) => !catalog?.elements.some((entry) => entry.id === elementId))) {
      throw new Error('A cena referencia elementos que não existem no catálogo.');
    }
    activeScene = scene;
    const menu = scene.fixture.kind === 'menu';
    document.getElementById('menu-screen').hidden = !menu;
    document.getElementById('game-screen').hidden = menu;
    document.getElementById('transition-curtain').hidden = true;
    document.getElementById('enemy-speech').hidden = true;
    document.getElementById('end-screen').hidden = true;
    document.getElementById('player').className = 'hand';
    document.getElementById('enemy').className = 'hand';
    document.getElementById('message').className = '';
    selectedId = scene.elementIds[0] || null;

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
    post('SCENE_APPLIED', { id: scene.id, elementIds: scene.elementIds });
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
      post('MODE_CHANGED', { mode });
      return;
    }
    if (message.type === 'SET_SELECTION') {
      if (message.id !== null && (typeof message.id !== 'string' || !validId.test(message.id) || !catalog?.elements.some((entry) => entry.id === message.id) || !activeScene?.elementIds.includes(message.id))) return;
      selectedId = message.id;
      showSelection();
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
        applyConfig(catalog, message.config, document);
        post('CONFIG_APPLIED');
      } catch (error) {
        post('PREVIEW_ERROR', { message: error instanceof Error ? error.message : 'Não foi possível aplicar a prévia.' });
      }
    }
  });

  const style = document.createElement('style');
  style.textContent = '[data-trindade-studio-selected="true"]{outline:3px solid #596eea!important;outline-offset:3px!important;position:relative!important}[data-studio-mode="edit"]{cursor:crosshair!important}';
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
    return waitForGameUi().then(() => {
      isReady = true;
      document.documentElement.dataset.studioMode = mode;
      post('PREVIEW_READY');
    });
  }).catch((error) => post('PREVIEW_ERROR', { message: error instanceof Error ? error.message : 'Falha ao inicializar a prévia.' }));
})();
