import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorElement, EditorProperty, ProjectPayload, RecentProject, StudioHomeState, UpdateCheckResult, VisualConfig } from '../types';
import { ASSETS, ELEMENT_LABELS, KIND_LABELS, PROPERTY_LABELS, configSnapshot, validateClientConfig, validateClientValue } from './schema';
import { STUDIO_SCENES } from './scenes';

type Mode = 'edit' | 'test';
type Device = 'desktop' | 'mobile';
type Prompt = 'close' | 'open' | 'home' | null;

interface Toast {
  kind: 'success' | 'error' | 'info';
  text: string;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function prettyName(element: EditorElement): string {
  return ELEMENT_LABELS[element.id] || element.id;
}

function propertyValue(config: VisualConfig, elementId: string, property: EditorProperty): string {
  return config.elements[elementId]?.base[property.key] ?? property.default;
}

export function App() {
  const [project, setProject] = useState<ProjectPayload | null>(null);
  const [view, setView] = useState<'home' | 'editor'>('home');
  const [homeState, setHomeState] = useState<StudioHomeState | null>(null);
  const [homeMessage, setHomeMessage] = useState('');
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [createDialog, setCreateDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('Meu jogo');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [newProjectParent, setNewProjectParent] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [busyProjectRoot, setBusyProjectRoot] = useState('');
  const [config, setConfig] = useState<VisualConfig | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [selectedId, setSelectedId] = useState('game.title');
  const [selectedSceneId, setSelectedSceneId] = useState('menu');
  const [mode, setMode] = useState<Mode>('edit');
  const [device, setDevice] = useState<Device>('desktop');
  const [previewReady, setPreviewReady] = useState(false);
  const [geometryMetrics, setGeometryMetrics] = useState<Record<string, { width: number; height: number }>>({});
  const [toast, setToast] = useState<Toast | null>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [historyVersion, setHistoryVersion] = useState(0);
  const undoStack = useRef<VisualConfig[]>([]);
  const redoStack = useRef<VisualConfig[]>([]);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const lastEdit = useRef<{ key: string; at: number } | null>(null);
  const rememberCurrentRef = useRef<(key: string, current: VisualConfig) => void>(() => {});
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const toastTimeout = useRef<number | undefined>(undefined);

  const dirty = Boolean(config && configSnapshot(config) !== savedSnapshot);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const catalog = project?.catalog;
  const elements = catalog?.elements ?? [];
  const selectedElement = elements.find((element) => element.id === selectedId) ?? null;
  const selectedScene = STUDIO_SCENES.find((scene) => scene.id === selectedSceneId) ?? STUDIO_SCENES[0];
  const sceneElements = useMemo(() => elements.filter((element) => selectedScene.elementIds.includes(element.id)), [elements, selectedScene]);
  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;
  const previewOrigin = project?.previewUrl ? new URL(project.previewUrl).origin : '';
  const previewSrc = useMemo(() => {
    if (!project?.previewUrl) return '';
    const url = new URL(project.previewUrl);
    url.searchParams.set('studioMode', mode);
    return url.href;
  }, [mode, project?.previewUrl]);

  const showToast = useCallback((kind: Toast['kind'], text: string) => {
    setToast({ kind, text });
    window.clearTimeout(toastTimeout.current);
    toastTimeout.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  const installProject = useCallback((payload: ProjectPayload) => {
    if (!payload.ok || !payload.catalog || !payload.config || !payload.previewUrl) {
      if (payload.error && !payload.canceled) showToast('error', payload.error);
      return false;
    }
    try {
      validateClientConfig(payload.catalog, payload.config);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'A configuração do projeto é inválida.');
      return false;
    }
    setProject(payload);
    setView('editor');
    setConfig(clone(payload.config));
    setSavedSnapshot(configSnapshot(payload.config));
    setSelectedId(payload.catalog.elements[0]?.id ?? '');
    setSelectedSceneId('menu');
    setPreviewReady(false);
    setMode('edit');
    setDrafts({});
    undoStack.current = [];
    redoStack.current = [];
    setHistoryVersion((value) => value + 1);
    if (payload.name) showToast('success', `Projeto “${payload.name}” aberto.`);
    return true;
  }, [showToast]);

  const refreshHomeState = useCallback(async () => {
    try {
      const value = await window.trindadeStudio.getHomeState();
      setHomeState(value);
      setNewProjectParent((current) => current || value.projectsDirectory);
      setSelectedTemplateId((current) => current || value.templates.find((template) => template.available)?.id || '');
    } catch (error) {
      setHomeMessage(error instanceof Error ? error.message : 'Não foi possível carregar a Central de Projetos.');
    }
  }, []);

  useEffect(() => {
    let active = true;
    window.trindadeStudio.getProject().then((payload) => {
      if (active) {
        if (payload.ok) installProject(payload);
        void refreshHomeState();
      }
    }).catch((error: unknown) => {
      if (active) showToast('error', error instanceof Error ? error.message : 'Não foi possível abrir o projeto.');
    });
    void refreshHomeState();
    const unsubscribeClose = window.trindadeStudio.onCloseRequest(() => setPrompt('close'));
    const unsubscribeSave = window.trindadeStudio.onSaveRequest(() => { void save(); });
    const unsubscribeOpen = window.trindadeStudio.onOpenProjectRequest(() => { void requestOpen(); });
    const unsubscribeHistory = window.trindadeStudio.onHistoryCommand((command) => command === 'undo' ? undo() : redo());
    const unsubscribeHome = window.trindadeStudio.onReturnHomeRequest(() => {
      if (dirtyRef.current) setPrompt('home');
      else {
        setView('home');
        setProject(null);
        setConfig(null);
        void window.trindadeStudio.setDirty(false);
        void refreshHomeState();
      }
    });
    return () => {
      active = false;
      unsubscribeClose();
      unsubscribeSave();
      unsubscribeOpen();
      unsubscribeHistory();
      unsubscribeHome();
      window.clearTimeout(toastTimeout.current);
    };
  }, []);

  useEffect(() => {
    void window.trindadeStudio.setDirty(dirty);
  }, [dirty]);

  const sendPreview = useCallback((type: string, detail: Record<string, unknown> = {}) => {
    if (!project?.previewUrl || !project.session) return;
    const target = previewFrame.current?.contentWindow;
    if (!target) return;
    target.postMessage({ protocol: 1, session: project.session, type, ...detail }, previewOrigin);
  }, [project, previewOrigin]);

  useEffect(() => {
    if (!previewReady || !config) return;
    sendPreview('APPLY_CONFIG', { config });
  }, [config, previewReady, sendPreview]);

  useEffect(() => {
    if (!previewReady) return;
    sendPreview('SET_MODE', { mode });
  }, [mode, previewReady, sendPreview]);

  useEffect(() => {
    if (!previewReady) return;
    sendPreview('SET_DEVICE', { device });
  }, [device, previewReady, sendPreview]);

  useEffect(() => {
    if (!previewReady) return;
    sendPreview('SET_SELECTION', { id: mode === 'edit' ? selectedId : null });
  }, [mode, previewReady, selectedId, sendPreview]);

  useEffect(() => {
    if (!project?.previewUrl || !project.session) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== previewOrigin || event.source !== previewFrame.current?.contentWindow) return;
      const message = event.data;
      if (!message || typeof message !== 'object' || message.protocol !== 1 || message.session !== project.session) return;
      if (message.type === 'PREVIEW_READY') {
        setPreviewReady(true);
        showToast('success', 'Prévia real do jogo pronta.');
      } else if (message.type === 'ELEMENT_SELECTED' && typeof message.id === 'string' && sceneElements.some((element) => element.id === message.id)) {
        setSelectedId(message.id);
      } else if (message.type === 'ELEMENT_METRICS' && typeof message.id === 'string' && Number.isFinite(message.width) && Number.isFinite(message.height)) {
        setGeometryMetrics((current) => ({ ...current, [message.id]: { width: message.width, height: message.height } }));
      } else if (message.type === 'GEOMETRY_CHANGED' && typeof message.id === 'string' && sceneElements.some((element) => element.id === message.id)) {
        const target = elements.find((element) => element.id === message.id);
        if (!config || !target?.geometry || !message.values || typeof message.values !== 'object') return;
        const next = clone(config);
        const entry = next.elements[message.id] || { base: {} };
        const breakpoint = message.breakpoint === 'mobile' ? 'mobile' : 'desktop';
        const values = Object.fromEntries(Object.entries(message.values).filter(([key, value]) => ['x', 'y', 'width', 'height'].includes(key) && typeof value === 'number')) as Record<string, number>;
        if (breakpoint === 'mobile') {
          entry.geometry = entry.geometry || {};
          entry.geometry.responsive = entry.geometry.responsive || {};
          entry.geometry.responsive.mobile = { ...(entry.geometry.responsive.mobile || {}), ...values };
        } else {
          entry.geometry = entry.geometry || {};
          entry.geometry.base = { ...(entry.geometry.base || {}), ...values };
        }
        next.elements[message.id] = entry;
        try {
          validateClientConfig(catalog!, next);
          rememberCurrentRef.current(`geometry.${message.id}.${breakpoint}`, config);
          setConfig(next);
          setSelectedId(message.id);
        } catch (error) {
          sendPreview('APPLY_CONFIG', { config });
          showToast('error', error instanceof Error ? error.message : 'Geometria fora dos limites permitidos.');
        }
      } else if (message.type === 'PREVIEW_ERROR' && typeof message.message === 'string') {
        showToast('error', `Prévia: ${message.message}`);
      }
    };
    window.addEventListener('message', onMessage);
    sendPreview('HELLO');
    return () => window.removeEventListener('message', onMessage);
  }, [catalog, config, elements, previewOrigin, project, sceneElements, sendPreview, showToast]);

  useEffect(() => {
    if (!previewReady || !config || !selectedScene) return;
    sendPreview('SET_SCENE', { id: selectedScene.id });
    // Reapply pending edits after a fixture has restored the runtime's original DOM state.
    sendPreview('APPLY_CONFIG', { config });
    sendPreview('SET_SELECTION', { id: mode === 'edit' && sceneElements.some((element) => element.id === selectedIdRef.current) ? selectedIdRef.current : null });
  }, [mode, previewReady, sceneElements, selectedScene.id, sendPreview]);

  const rememberCurrent = useCallback((key: string, current: VisualConfig) => {
    const previous = lastEdit.current;
    const now = Date.now();
    if (!previous || previous.key !== key || now - previous.at > 900) undoStack.current.push(clone(current));
    lastEdit.current = { key, at: now };
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    setHistoryVersion((value) => value + 1);
  }, []);
  rememberCurrentRef.current = rememberCurrent;

  const updateProperty = useCallback((elementId: string, property: EditorProperty, value: string) => {
    if (!config || !catalog || !validateClientValue(property.type, value, property.maxLength)) return;
    const key = `${elementId}.${property.key}`;
    rememberCurrent(key, config);
    const next = clone(config);
    if (!next.elements[elementId]) next.elements[elementId] = { base: {} };
    next.elements[elementId].base[property.key] = value;
    setConfig(next);
    setDrafts((current) => ({ ...current, [key]: value }));
  }, [catalog, config, rememberCurrent]);

  const updateGeometry = useCallback((element: EditorElement, field: 'x' | 'y' | 'width' | 'height', value: number) => {
    if (!config || !catalog || !element.geometry || !Number.isFinite(value)) return;
    const limits = element.geometry.limits[field];
    if (value < limits.min || value > limits.max) {
      showToast('error', `${field.toUpperCase()} deve ficar entre ${limits.min} e ${limits.max} px.`);
      return;
    }
    rememberCurrent(`geometry.${element.id}.${device}`, config);
    const next = clone(config);
    const entry = next.elements[element.id] || { base: {} };
    entry.geometry = entry.geometry || {};
    if (device === 'mobile') {
      entry.geometry.responsive = entry.geometry.responsive || {};
      entry.geometry.responsive.mobile = { ...(entry.geometry.responsive.mobile || {}), [field]: value };
    } else {
      entry.geometry.base = { ...(entry.geometry.base || {}), [field]: value };
    }
    next.elements[element.id] = entry;
    try { validateClientConfig(catalog, next); setConfig(next); }
    catch (error) { showToast('error', error instanceof Error ? error.message : 'Geometria inválida.'); }
  }, [catalog, config, device, rememberCurrent, showToast]);

  const resetGeometry = useCallback((element: EditorElement) => {
    if (!config || !element.geometry) return;
    rememberCurrent(`geometry.${element.id}.reset`, config);
    const next = clone(config);
    if (next.elements[element.id]) delete next.elements[element.id].geometry;
    setConfig(next);
    showToast('info', 'Geometria original restaurada.');
  }, [config, rememberCurrent, showToast]);

  const alignGeometry = (axis: 'horizontal' | 'vertical') => sendPreview('ALIGN_SELECTION', { axis });

  const undo = useCallback(() => {
    if (!config || undoStack.current.length === 0) return;
    redoStack.current.push(clone(config));
    setConfig(undoStack.current.pop()!);
    lastEdit.current = null;
    setHistoryVersion((value) => value + 1);
  }, [config]);

  const redo = useCallback(() => {
    if (!config || redoStack.current.length === 0) return;
    undoStack.current.push(clone(config));
    setConfig(redoStack.current.pop()!);
    lastEdit.current = null;
    setHistoryVersion((value) => value + 1);
  }, [config]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!config || !catalog || saving) return false;
    try {
      validateClientConfig(catalog, config);
      setSaving(true);
      const result = await window.trindadeStudio.saveVisualConfig(config);
      if (!result.ok || !result.config) throw new Error('O Studio não confirmou o salvamento.');
      setConfig(result.config);
      setSavedSnapshot(configSnapshot(result.config));
      showToast('success', 'Alterações salvas. Uma cópia anterior ficou em segurança.');
      return true;
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Não foi possível salvar a configuração.');
      return false;
    } finally {
      setSaving(false);
    }
  }, [catalog, config, saving, showToast]);

  const openProject = useCallback(async () => {
    const payload = await window.trindadeStudio.openProject();
    installProject(payload);
  }, [installProject]);

  const goHome = useCallback(() => {
    setView('home');
    setProject(null);
    setConfig(null);
    setPreviewReady(false);
    setMode('edit');
    void window.trindadeStudio.setDirty(false);
    void refreshHomeState();
  }, [refreshHomeState]);

  const requestHome = useCallback(() => {
    if (dirty) setPrompt('home');
    else goHome();
  }, [dirty, goHome]);

  const requestOpen = useCallback(() => {
    if (dirty) setPrompt('open');
    else void openProject();
  }, [dirty, openProject]);

  const openRecentProject = useCallback(async (recent: RecentProject) => {
    setBusyProjectRoot(recent.root);
    setHomeMessage('');
    try {
      const payload = await window.trindadeStudio.openRecentProject(recent.root);
      installProject(payload);
    } catch (error) {
      setHomeMessage(error instanceof Error ? error.message : 'Não foi possível abrir o projeto recente.');
    } finally {
      setBusyProjectRoot('');
      void refreshHomeState();
    }
  }, [installProject, refreshHomeState]);

  const removeRecentProject = useCallback(async (recent: RecentProject) => {
    const result = await window.trindadeStudio.removeRecentProject(recent.root);
    if (homeState) setHomeState({ ...homeState, recentProjects: result.recentProjects });
  }, [homeState]);

  const chooseNewProjectParent = useCallback(async () => {
    const result = await window.trindadeStudio.chooseProjectParent();
    if (!result.canceled && result.path) setNewProjectParent(result.path);
  }, []);

  const createNewProject = useCallback(async () => {
    setCreatingProject(true);
    setHomeMessage('');
    try {
      const payload = await window.trindadeStudio.createProject({ name: newProjectName, templateId: selectedTemplateId });
      if (installProject(payload)) setCreateDialog(false);
      else if (payload.error) setHomeMessage(payload.error);
    } catch (error) {
      setHomeMessage(error instanceof Error ? error.message : 'Não foi possível criar o projeto.');
    } finally {
      setCreatingProject(false);
      void refreshHomeState();
    }
  }, [installProject, newProjectName, refreshHomeState, selectedTemplateId]);

  const checkUpdates = useCallback(async () => {
    setCheckingUpdates(true);
    setUpdateCheck({ state: 'error', currentVersion: homeState?.appVersion || '0.0.0', message: 'Verificando releases estáveis oficiais…' });
    try {
      setUpdateCheck(await window.trindadeStudio.checkForUpdates());
    } catch (error) {
      setUpdateCheck({ state: 'error', currentVersion: homeState?.appVersion || '0.0.0', message: error instanceof Error ? error.message : 'Não foi possível verificar atualizações.' });
    } finally {
      setCheckingUpdates(false);
    }
  }, [homeState?.appVersion]);

  const openManualUpdate = useCallback(async () => {
    if (!updateCheck?.pageUrl) return;
    try {
      await window.trindadeStudio.openReleasePage(updateCheck.pageUrl);
      setHomeMessage('Página oficial aberta no navegador. Baixe o instalador da release e execute-o para atualizar. O Studio não instala arquivos sem assinatura verificada.');
    } catch (error) {
      setHomeMessage(error instanceof Error ? error.message : 'Não foi possível abrir a página oficial.');
    }
  }, [updateCheck?.pageUrl]);

  const answerPrompt = useCallback(async (choice: 'save' | 'discard' | 'cancel') => {
    if (prompt === 'close') {
      if (choice === 'save' && !(await save())) return;
      const result = await window.trindadeStudio.respondToClose(choice);
      if (choice === 'save' && result.needsSave) showToast('error', 'Salve as alterações antes de fechar.');
      if (choice === 'cancel' || !result.ok) setPrompt(null);
      return;
    }
    const requestedAction = prompt;
    setPrompt(null);
    if (choice === 'cancel') return;
    if (choice === 'save' && !(await save())) return;
    if (requestedAction === 'home') {
      goHome();
      return;
    }
    await openProject();
  }, [goHome, openProject, prompt, save, showToast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        void save();
      } else if (key === 'z' && event.shiftKey) {
        event.preventDefault();
        redo();
      } else if (key === 'z') {
        event.preventDefault();
        undo();
      } else if (key === 'y') {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redo, save, undo]);

  const title = useMemo(() => project?.name || 'Nenhum projeto aberto', [project?.name]);
  const canSave = dirty && !saving;
  const selectScene = (sceneId: string) => {
    const scene = STUDIO_SCENES.find((entry) => entry.id === sceneId);
    if (!scene || mode !== 'edit') return;
    setSelectedSceneId(scene.id);
    setSelectedId(scene.elementIds[0] || '');
  };

  if (view === 'home') {
    const updateStatus = updateCheck?.state === 'available'
      ? `A versão ${updateCheck.latestVersion} está disponível.`
      : updateCheck?.state === 'up-to-date'
        ? 'Você está usando a versão mais recente.'
        : updateCheck?.state === 'local-ahead'
          ? `A versão instalada (${updateCheck.currentVersion}) está à frente da release estável (${updateCheck.latestVersion}); nenhuma regressão será oferecida.`
        : updateCheck?.state === 'offline'
          ? 'Sem conexão. O Studio continua disponível offline.'
          : updateCheck?.state === 'error'
            ? updateCheck.message
            : '';
    return (
      <div className="home-shell">
        <header className="home-topbar">
          <div className="brand-block"><div className="brand-mark" aria-hidden="true">T</div><div className="brand-name"><strong>Trindade</strong><span>STUDIO</span></div></div>
          <div className="home-version"><span>Studio</span><strong>v{homeState?.appVersion || '—'}</strong></div>
        </header>
        <main className="home-content">
          <section className="home-welcome">
            <div><span className="eyebrow">ENGINE VISUAL PARA O JOGO</span><h1>O que vamos criar hoje?</h1><p>Abra um projeto recente ou comece um jogo em uma pasta sua.</p></div>
            <div className="home-primary-actions">
              <button className="button button-primary home-create" onClick={() => { setHomeMessage(''); setCreateDialog(true); }}><span aria-hidden="true">＋</span>Novo projeto</button>
              <button className="button button-quiet" onClick={() => void openProject()}><span aria-hidden="true">▱</span>Abrir projeto</button>
            </div>
          </section>
          <section className="home-columns">
            <div className="home-card recent-card">
              <div className="home-card-heading"><div><span className="eyebrow">CONTINUAR</span><h2>Projetos recentes</h2></div><button className="icon-button" onClick={() => void refreshHomeState()} title="Atualizar lista" aria-label="Atualizar lista">↻</button></div>
              {homeState?.recentProjects.length ? (
                <div className="recent-project-list">
                  {homeState.recentProjects.map((recent) => (
                    <article className={`recent-project ${recent.unavailable ? 'recent-unavailable' : ''}`} key={`${recent.root}-${recent.id}`}>
                      <div className="recent-project-icon" aria-hidden="true">◈</div>
                      <div className="recent-project-copy"><strong>{recent.name}</strong><span title={recent.root}>{recent.root}</span><small>{recent.needsImport ? 'Projeto legado · será solicitado backup ao abrir' : recent.unavailable ? 'Pasta ausente ou incompatível' : `Formato de projeto v${recent.projectFormatVersion} · ${recent.lastOpenedAt ? new Date(recent.lastOpenedAt).toLocaleString() : 'recentemente'}`}</small></div>
                      <button className="button button-quiet recent-open" onClick={() => void openRecentProject(recent)} disabled={Boolean(recent.unavailable) || busyProjectRoot === recent.root}>{busyProjectRoot === recent.root ? 'Abrindo…' : 'Abrir'}</button>
                      <button className="recent-remove" onClick={() => void removeRecentProject(recent)} title="Remover da lista sem apagar os arquivos" aria-label={`Remover ${recent.name} da lista`}>×</button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="home-empty"><span aria-hidden="true">◈</span><strong>Nenhum projeto recente</strong><p>Crie um novo projeto ou abra uma pasta do jogo para começar.</p></div>
              )}
              <div className="projects-location"><span className="location-icon" aria-hidden="true">⌖</span><div><small>LOCALIZAÇÃO PADRÃO</small><strong title={homeState?.projectsDirectory}>{homeState?.projectsDirectory || 'Carregando…'}</strong></div></div>
            </div>
            <aside className="home-card update-card">
              <div className="update-card-icon" aria-hidden="true">↻</div>
              <span className="eyebrow">VERSÃO DO APLICATIVO</span><h2>Atualizações do Studio</h2>
              <p>Versão instalada <strong>v{homeState?.appVersion || '—'}</strong> · canal estável do GitHub.</p>
              <button className="button button-quiet update-check-button" onClick={() => void checkUpdates()} disabled={checkingUpdates}>{checkingUpdates ? <><span className="spinner spinner-violet" />Verificando…</> : 'Verificar atualizações'}</button>
              {updateStatus && <div className={`update-status update-${updateCheck?.state || 'checking'}`} role="status"><span className="update-status-dot" />{updateStatus}</div>}
              {updateCheck?.state === 'available' && <>
                {updateCheck.publishedAt && <small className="release-date">Publicada em {new Date(updateCheck.publishedAt).toLocaleDateString()}</small>}
                {updateCheck.notes && <pre className="release-notes">{updateCheck.notes}</pre>}
                <button className="button button-primary manual-update-button" onClick={() => void openManualUpdate()}>Abrir release e baixar manualmente</button>
                <small className="update-security-note">A instalação automática está desativada neste build sem assinatura digital do publicador.</small>
              </>}
              <div className="update-source"><span className="secure-dot" />Fonte verificada: <code>github.com/EmersonOxy/PPT-Pedra-Papel-e-Tesoura-</code></div>
            </aside>
          </section>
          {homeMessage && <div className="home-message" role="status">{homeMessage}</div>}
          <footer className="home-footer">Projetos e preferências ficam no seu perfil do Windows, separados da instalação do Studio.</footer>
        </main>

        {createDialog && <div className="modal-backdrop" role="presentation"><section className="confirm-modal project-wizard" role="dialog" aria-modal="true" aria-labelledby="new-project-title">
          <div className="modal-icon">＋</div><span className="eyebrow">NOVO PROJETO</span><h2 id="new-project-title">Comece com um modelo</h2><p>Os arquivos serão copiados para uma pasta independente. Projetos existentes nunca são sobrescritos.</p>
          <label className="wizard-label" htmlFor="new-project-name">Nome do projeto</label><input id="new-project-name" className="wizard-input" value={newProjectName} maxLength={50} onChange={(event) => setNewProjectName(event.target.value)} />
          <label className="wizard-label" htmlFor="new-project-template">Modelo inicial</label><select id="new-project-template" className="wizard-input" value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>{(homeState?.templates || []).filter((template) => template.available).map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}</select>
          <div className="wizard-location"><div><small>PASTA DOS PROJETOS</small><strong title={newProjectParent}>{newProjectParent || homeState?.projectsDirectory}</strong></div><button className="button button-quiet" onClick={() => void chooseNewProjectParent()}>Escolher…</button></div>
          {homeMessage && <p className="wizard-error" role="alert">{homeMessage}</p>}
          <div className="modal-actions"><button className="button button-quiet" onClick={() => setCreateDialog(false)} disabled={creatingProject}>Cancelar</button><button className="button button-primary" onClick={() => void createNewProject()} disabled={creatingProject || !newProjectName.trim()}>{creatingProject ? 'Criando…' : 'Criar projeto'}</button></div>
        </section></div>}
        {prompt && <div className="modal-backdrop" role="presentation"><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><div className="modal-icon">↗</div><h2 id="confirm-title">Há alterações não salvas</h2><p>Salve antes de voltar à Central de Projetos. Você também pode descartar as alterações ou continuar editando.</p><div className="modal-actions"><button className="button button-quiet" onClick={() => void answerPrompt('cancel')}>Continuar editando</button><button className="button button-quiet" onClick={() => void answerPrompt('discard')}>Descartar</button><button className="button button-primary" onClick={() => void answerPrompt('save')}>Salvar e voltar</button></div></section></div>}
      </div>
    );
  }

  return (
    <div className="studio-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">T</div>
          <div className="brand-name"><strong>Trindade</strong><span>STUDIO</span></div>
        </div>
        <div className="project-heading">
          <div className="project-name" title={title}>{title}</div>
          <div className={`save-state ${dirty ? 'is-dirty' : ''}`}><i />{dirty ? 'Alterações não salvas' : 'Tudo salvo'}</div>
        </div>
        <div className="top-actions">
          <button className="button button-quiet" onClick={requestHome} title="Voltar à Central de Projetos">Projetos</button>
          <button className="button button-quiet" onClick={requestOpen} title="Abrir uma pasta de projeto">
            <span className="button-icon" aria-hidden="true">▱</span><span>Abrir projeto</span>
          </button>
          <div className="action-divider" />
          <button className="icon-button" onClick={undo} disabled={!canUndo} title="Desfazer (Ctrl+Z)" aria-label="Desfazer" key={`undo-${historyVersion}`}>↶</button>
          <button className="icon-button" onClick={redo} disabled={!canRedo} title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer" key={`redo-${historyVersion}`}>↷</button>
          <button className="button button-primary save-button" onClick={() => void save()} disabled={!canSave} title="Salvar (Ctrl+S)">
            {saving ? <span className="spinner" /> : <span className="button-icon" aria-hidden="true">✓</span>}
            <span>{saving ? 'Salvando…' : 'Salvar'}</span>
          </button>
          <div className="action-divider" />
          <button className="button button-test" onClick={() => setMode((current) => current === 'edit' ? 'test' : 'edit')} disabled={!project?.ok}>
            <span aria-hidden="true">{mode === 'edit' ? '▶' : '✎'}</span>{mode === 'edit' ? 'Testar' : 'Voltar a editar'}
          </button>
          <button className="icon-button close-button" onClick={() => void window.trindadeStudio.closeStudio()} title="Fechar Studio" aria-label="Fechar Studio">×</button>
        </div>
      </header>

      <main className="workspace">
        <aside className="panel layers-panel" aria-label="Navegador de telas e elementos do jogo">
          <div className="panel-heading">
            <div><span className="eyebrow">CENAS DO JOGO</span><h1>Telas</h1></div>
            <span className="count-pill">{STUDIO_SCENES.length}</span>
          </div>
          <p className="panel-intro">Escolha uma tela ou estado real do jogo para abrir no canvas.</p>
          <div className="scene-list" role="listbox" aria-label="Telas e estados do jogo">
            {STUDIO_SCENES.map((scene, index) => (
              <button key={scene.id} data-scene-id={scene.id} className={`scene-item ${selectedScene.id === scene.id ? 'selected' : ''}`} onClick={() => selectScene(scene.id)} role="option" aria-selected={selectedScene.id === scene.id} disabled={mode === 'test'} title={scene.description}>
                <span className="scene-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="layer-copy"><strong>{scene.label}</strong><small>{scene.screen === 'menu' ? 'Tela inicial' : scene.fixture.kind === 'combat' ? 'Estado de combate' : scene.fixture.kind === 'battle-result' ? 'Resultado de combate' : 'Resultado da partida'}</small></span>
              </button>
            ))}
          </div>
          <div className="layer-subheading"><span className="eyebrow">ELEMENTOS DA TELA</span><span className="count-pill">{sceneElements.length}</span></div>
          <p className="scene-description">{selectedScene.description}</p>
          {sceneElements.length > 0 ? (
            <div className="layer-list" role="listbox" aria-label={`Elementos editáveis em ${selectedScene.label}`}>
              {sceneElements.map((element, index) => (
                <button key={element.id} data-element-id={element.id} className={`layer-item ${selectedId === element.id ? 'selected' : ''}`} onClick={() => { setSelectedId(element.id); setMode('edit'); }} role="option" aria-selected={selectedId === element.id} disabled={mode === 'test'}>
                  <span className={`layer-icon kind-${element.kind}`} aria-hidden="true">{element.kind === 'text' ? 'T' : element.kind === 'image' ? '▧' : element.kind === 'button' ? '▰' : element.kind === 'meter' ? '▥' : '▢'}</span>
                  <span className="layer-copy"><strong>{prettyName(element)}</strong><small>{KIND_LABELS[element.kind] || element.kind}</small></span>
                  <span className="layer-index">{String(index + 1).padStart(2, '0')}</span>
                </button>
              ))}
            </div>
          ) : (
            project?.ok
              ? <div className="empty-panel"><div className="empty-icon">◈</div><strong>Estado sem alvos editáveis</strong><p>Esta tela pode ser visualizada, mas ainda não possui elementos com suporte a edição.</p></div>
              : <div className="empty-panel"><div className="empty-icon">▱</div><strong>Abra um projeto</strong><p>Escolha a pasta do jogo para carregar as telas e os elementos editáveis.</p><button className="text-button" onClick={() => void openProject()}>Selecionar pasta</button></div>
          )}
          <div className="layers-footnote"><span className="dot dot-violet" />Elementos editáveis vêm do catálogo oficial.</div>
        </aside>

        <section className="canvas-column" aria-label="Prévia do jogo">
          <div className="canvas-toolbar">
            <div className="canvas-title"><span className="canvas-title-icon">◫</span><div><strong>{mode === 'edit' ? selectedScene.label : 'Modo Testar'}</strong><small>{mode === 'edit' ? 'Fixture demonstrativa · selecione elementos registrados' : 'Jogo real reiniciado para uma partida de teste'}</small></div></div>
            <div className="device-toggle" role="group" aria-label="Tamanho da prévia">
              <button className={device === 'desktop' ? 'active' : ''} onClick={() => setDevice('desktop')} aria-pressed={device === 'desktop'} title="Visualização desktop"><span aria-hidden="true">▱</span><span>Desktop</span></button>
              <button className={device === 'mobile' ? 'active' : ''} onClick={() => setDevice('mobile')} aria-pressed={device === 'mobile'} title="Visualização celular"><span aria-hidden="true">▯</span><span>Celular</span></button>
            </div>
          </div>
          <div className={`canvas-stage ${device === 'mobile' ? 'mobile-stage' : ''}`}>
            {project?.previewUrl ? (
              <div className={`preview-frame-wrap ${device === 'mobile' ? 'mobile-preview' : ''}`}>
                <div className="preview-frame-header"><div className="window-dots"><i /><i /><i /></div><span>{device === 'mobile' ? '390 × 844' : 'Jogo modular · prévia local'}</span><span className="secure-tag"><i />Local</span></div>
                <iframe
                  ref={previewFrame}
                  key={`${project.session}-${mode}`}
                  className={`game-preview ${mode === 'edit' ? 'editing' : 'testing'}`}
                  title="Prévia interativa do jogo Pedra, Papel e Tesoura"
                  src={previewSrc}
                  sandbox="allow-scripts allow-same-origin"
                  referrerPolicy="no-referrer"
                  onLoad={() => {
                    setPreviewReady(false);
                    sendPreview('HELLO');
                  }}
                />
              </div>
            ) : (
              <div className="canvas-empty"><div className="canvas-empty-icon">✦</div><h2>Seu jogo aparece aqui</h2><p>Abra a pasta do projeto para carregar a prévia real e os elementos editáveis.</p><button className="button button-primary" onClick={() => void openProject()}>Abrir projeto</button></div>
            )}
          </div>
          <div className="canvas-statusbar"><div><span className={`status-led ${previewReady ? 'online' : ''}`} />{previewReady ? (mode === 'edit' ? 'Modo de edição' : 'Modo de teste') : 'Carregando prévia'}</div><span>Protocolo de editor v1</span></div>
        </section>

        <aside className="panel inspector-panel" aria-label="Propriedades do elemento">
          <div className="panel-heading inspector-heading">
            <div><span className="eyebrow">INSPETOR</span><h1>Propriedades</h1></div>
            {selectedElement && <span className={`layer-icon inspector-kind kind-${selectedElement.kind}`} aria-hidden="true">{selectedElement.kind === 'text' ? 'T' : selectedElement.kind === 'image' ? '▧' : selectedElement.kind === 'button' ? '▰' : selectedElement.kind === 'meter' ? '▥' : '▢'}</span>}
          </div>
          {selectedElement && config ? (
            <>
              <div className="selected-element-card"><span className="selected-indicator" /><div><strong>{prettyName(selectedElement)}</strong><small>{selectedElement.id}</small></div></div>
              <div className="property-list">
                {selectedElement.properties.map((property) => {
                  const key = `${selectedElement.id}.${property.key}`;
                  const value = propertyValue(config, selectedElement.id, property);
                  const draft = drafts[key] ?? value;
                  const invalid = !validateClientValue(property.type, draft, property.maxLength);
                  const bindingCount = catalog?.elements.flatMap((element) => element.properties.map((item) => ({ element, item }))).filter(({ item }) => item.binding.operation === property.binding.operation && item.type === property.type).length ?? 1;
                  return (
                    <div className="property-field" key={key}>
                      <div className="field-heading"><label htmlFor={`property-${key}`}>{PROPERTY_LABELS[property.key] || property.key}</label><span className="field-type">{property.type === 'text' ? 'TEXTO' : property.type === 'color' ? 'COR' : 'ASSET'}</span></div>
                      {property.type === 'text' && (
                        <div className="text-input-wrap"><input id={`property-${key}`} type="text" maxLength={property.maxLength || 80} value={draft} onChange={(event) => updateProperty(selectedElement.id, property, event.target.value)} aria-invalid={invalid} /><span>{draft.length}/{property.maxLength || 80}</span></div>
                      )}
                      {property.type === 'color' && (
                        <div className="color-input-wrap">
                          <label className="color-swatch" htmlFor={`color-${key}`} style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff' }} title="Escolher cor"><input id={`color-${key}`} type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(event) => updateProperty(selectedElement.id, property, event.target.value)} aria-label="Escolher cor" /></label>
                          <input id={`property-${key}`} className="color-text" type="text" value={draft} maxLength={7} onChange={(event) => {
                            const nextDraft = event.target.value;
                            setDrafts((current) => ({ ...current, [key]: nextDraft }));
                            if (validateClientValue(property.type, nextDraft)) updateProperty(selectedElement.id, property, nextDraft);
                          }} onBlur={() => setDrafts((current) => ({ ...current, [key]: value }))} aria-invalid={invalid} aria-label="Código hexadecimal da cor" />
                          <span className="hex-hint">HEX</span>
                        </div>
                      )}
                      {property.type === 'imageAsset' && (
                        <label className="select-wrap" htmlFor={`property-${key}`}><span className="asset-thumb">{ASSETS.find((asset) => asset.id === value)?.label.slice(0, 1) || '▧'}</span><select id={`property-${key}`} value={value} onChange={(event) => updateProperty(selectedElement.id, property, event.target.value)}>{ASSETS.map((asset) => <option key={asset.id} value={asset.id}>{asset.label}</option>)}</select><span className="select-chevron">⌄</span></label>
                      )}
                      {invalid && <p className="field-error">Valor inválido. Use texto simples, cor #RRGGBB ou asset registrado.</p>}
                      {property.binding.operation === 'styleVariable' && bindingCount > 1 && <p className="binding-note"><span aria-hidden="true">ⓘ</span> Este token aparece em {bindingCount} controles. O valor é aplicado ao alvo selecionado e cada botão mantém seu próprio valor.</p>}
                    </div>
                  );
                })}
              </div>
              {selectedElement.geometry && (
                <section className="geometry-editor" aria-label="Geometria do elemento">
                  <div className="geometry-heading"><div><span className="eyebrow">GEOMETRIA · {device === 'mobile' ? 'CELULAR' : 'DESKTOP'}</span><strong>Posição e tamanho</strong></div><span className="geometry-unit">px</span></div>
                  <div className="geometry-fields">
                    {(['x', 'y', 'width', 'height'] as const).map((field) => {
                      const entry = config.elements[selectedElement.id]?.geometry;
                      const fallback = field === 'width' || field === 'height' ? geometryMetrics[selectedElement.id]?.[field] : selectedElement.geometry!.default[field];
                      const value = (device === 'mobile' ? entry?.responsive?.mobile?.[field] : undefined) ?? entry?.base?.[field] ?? selectedElement.geometry!.default[field] ?? fallback ?? 0;
                      const limits = selectedElement.geometry!.limits[field];
                      return <label key={field} className="geometry-field"><span>{field === 'x' ? 'X' : field === 'y' ? 'Y' : field === 'width' ? 'Largura' : 'Altura'}</span><input aria-label={`${field} em pixels`} type="number" step={1} min={limits.min} max={limits.max} value={value} onChange={(event) => updateGeometry(selectedElement, field, Number(event.target.value))} /></label>;
                    })}
                  </div>
                  <p className="geometry-hint">{device === 'mobile' ? 'Ajustes de celular usam override próprio.' : 'Ajustes desktop não substituem o override de celular.'}</p>
                  <div className="geometry-actions"><button className="button button-quiet" onClick={() => alignGeometry('horizontal')} title="Centralizar horizontalmente">↔ Centralizar</button><button className="button button-quiet" onClick={() => alignGeometry('vertical')} title="Centralizar verticalmente">↕ Centralizar</button></div>
                  <button className="geometry-reset" onClick={() => resetGeometry(selectedElement)}>Restaurar geometria original</button>
                  <p className="geometry-hint">Arraste o elemento selecionado; use as alças nos cantos para redimensionar.</p>
                </section>
              )}
              <div className="inspector-divider" />
              <div className="inspector-info"><span className="info-check">✓</span><p>Propriedades validadas pelo catálogo. O jogo aceita somente valores registrados.</p></div>
            </>
          ) : (
            <div className="inspector-empty"><span>◈</span><strong>Selecione um elemento</strong><p>Clique em um item na lista ou diretamente no jogo para editar suas propriedades.</p></div>
          )}
          <div className="inspector-footer"><span className="lock-icon">⌑</span>Sem código ou CSS arbitrário</div>
        </aside>
      </main>

      {toast && <div className={`toast toast-${toast.kind}`} role="status"><span className="toast-mark">{toast.kind === 'error' ? '!' : toast.kind === 'success' ? '✓' : 'i'}</span>{toast.text}<button onClick={() => setToast(null)} aria-label="Fechar aviso">×</button></div>}

      {prompt && <div className="modal-backdrop" role="presentation"><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><div className="modal-icon">{prompt === 'close' ? '↗' : '▱'}</div><h2 id="confirm-title">{prompt === 'close' ? 'Há alterações não salvas' : prompt === 'home' ? 'Salvar antes de voltar à Central?' : 'Salvar antes de abrir outro projeto?'}</h2><p>{prompt === 'close' ? 'Suas últimas mudanças ainda não foram gravadas no projeto.' : prompt === 'home' ? 'Você pode salvar as alterações atuais antes de voltar à Central de Projetos.' : 'Você pode salvar as alterações atuais antes de escolher outra pasta.'}</p><div className="modal-actions"><button className="button button-quiet" onClick={() => void answerPrompt('cancel')}>{prompt === 'close' ? 'Continuar editando' : 'Cancelar'}</button><button className="button button-quiet" onClick={() => void answerPrompt('discard')}>{prompt === 'close' ? 'Descartar' : 'Descartar alterações'}</button><button className="button button-primary" onClick={() => void answerPrompt('save')}>Salvar{prompt === 'home' ? ' e voltar' : ''}</button></div></section></div>}
    </div>
  );
}
