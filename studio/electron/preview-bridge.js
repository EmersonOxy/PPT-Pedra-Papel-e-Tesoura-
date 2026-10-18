(() => {
  const scriptSource = document.currentScript?.src;
  const query = new URL(scriptSource || location.href).searchParams;
  const parentOrigin = query.get('studioParent');
  const session = query.get('studioSession');
  const protocol = 1;
  const validId = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;
  let mode = 'edit';
  let selectedId = null;
  let catalog = null;
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
    if (!selectedId || !validId.test(selectedId)) return;
    const target = document.querySelector(`[data-editor-id="${selectedId}"]`);
    if (target) target.setAttribute('data-trindade-studio-selected', 'true');
  }

  document.addEventListener('click', (event) => {
    if (mode !== 'edit') return;
    const target = event.composedPath().find((item) => item instanceof Element && item.hasAttribute('data-editor-id'));
    if (target) {
      const id = target.getAttribute('data-editor-id');
      if (id && validId.test(id) && catalog?.elements.some((entry) => entry.id === id)) {
        selectedId = id;
        showSelection();
        post('ELEMENT_SELECTED', { id });
      }
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

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
      if (message.id !== null && (typeof message.id !== 'string' || !validId.test(message.id) || !catalog?.elements.some((entry) => entry.id === message.id))) return;
      selectedId = message.id;
      showSelection();
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
    import('/src/game/ui/visual-config.js'),
  ]).then(([loadedCatalog, visualConfig]) => {
    catalog = loadedCatalog;
    applyConfig = visualConfig.applyVisualConfiguration;
    isReady = true;
    document.documentElement.dataset.studioMode = mode;
    post('PREVIEW_READY');
  }).catch((error) => post('PREVIEW_ERROR', { message: error instanceof Error ? error.message : 'Falha ao inicializar a prévia.' }));
})();
