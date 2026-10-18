import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorElement, EditorProperty, ProjectPayload, VisualConfig } from '../types';
import { ASSETS, ELEMENT_LABELS, KIND_LABELS, PROPERTY_LABELS, configSnapshot, validateClientConfig, validateClientValue } from './schema';

type Mode = 'edit' | 'test';
type Device = 'desktop' | 'mobile';
type Prompt = 'close' | 'open' | null;

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
  const [config, setConfig] = useState<VisualConfig | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [selectedId, setSelectedId] = useState('game.title');
  const [mode, setMode] = useState<Mode>('edit');
  const [device, setDevice] = useState<Device>('desktop');
  const [previewReady, setPreviewReady] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [historyVersion, setHistoryVersion] = useState(0);
  const undoStack = useRef<VisualConfig[]>([]);
  const redoStack = useRef<VisualConfig[]>([]);
  const lastEdit = useRef<{ key: string; at: number } | null>(null);
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const toastTimeout = useRef<number | undefined>(undefined);

  const dirty = Boolean(config && configSnapshot(config) !== savedSnapshot);
  const catalog = project?.catalog;
  const elements = catalog?.elements ?? [];
  const selectedElement = elements.find((element) => element.id === selectedId) ?? null;
  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;
  const previewOrigin = project?.previewUrl ? new URL(project.previewUrl).origin : '';

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
    setConfig(clone(payload.config));
    setSavedSnapshot(configSnapshot(payload.config));
    setSelectedId(payload.catalog.elements[0]?.id ?? '');
    setPreviewReady(false);
    setMode('edit');
    setDrafts({});
    undoStack.current = [];
    redoStack.current = [];
    setHistoryVersion((value) => value + 1);
    if (payload.name) showToast('success', `Projeto “${payload.name}” aberto.`);
    return true;
  }, [showToast]);

  useEffect(() => {
    let active = true;
    window.trindadeStudio.getProject().then((payload) => {
      if (active) installProject(payload);
    }).catch((error: unknown) => {
      if (active) showToast('error', error instanceof Error ? error.message : 'Não foi possível abrir o projeto.');
    });
    const unsubscribeClose = window.trindadeStudio.onCloseRequest(() => setPrompt('close'));
    const unsubscribeSave = window.trindadeStudio.onSaveRequest(() => { void save(); });
    const unsubscribeOpen = window.trindadeStudio.onOpenProjectRequest(() => { void requestOpen(); });
    const unsubscribeHistory = window.trindadeStudio.onHistoryCommand((command) => command === 'undo' ? undo() : redo());
    return () => {
      active = false;
      unsubscribeClose();
      unsubscribeSave();
      unsubscribeOpen();
      unsubscribeHistory();
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
      } else if (message.type === 'ELEMENT_SELECTED' && typeof message.id === 'string' && elements.some((element) => element.id === message.id)) {
        setSelectedId(message.id);
      } else if (message.type === 'PREVIEW_ERROR' && typeof message.message === 'string') {
        showToast('error', `Prévia: ${message.message}`);
      }
    };
    window.addEventListener('message', onMessage);
    sendPreview('HELLO');
    return () => window.removeEventListener('message', onMessage);
  }, [elements, previewOrigin, project, sendPreview, showToast]);

  const rememberCurrent = useCallback((key: string, current: VisualConfig) => {
    const previous = lastEdit.current;
    const now = Date.now();
    if (!previous || previous.key !== key || now - previous.at > 900) undoStack.current.push(clone(current));
    lastEdit.current = { key, at: now };
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    setHistoryVersion((value) => value + 1);
  }, []);

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

  const requestOpen = useCallback(() => {
    if (dirty) setPrompt('open');
    else void openProject();
  }, [dirty, openProject]);

  const answerPrompt = useCallback(async (choice: 'save' | 'discard' | 'cancel') => {
    if (prompt === 'close') {
      if (choice === 'save' && !(await save())) return;
      const result = await window.trindadeStudio.respondToClose(choice);
      if (choice === 'save' && result.needsSave) showToast('error', 'Salve as alterações antes de fechar.');
      if (choice === 'cancel' || !result.ok) setPrompt(null);
      return;
    }
    setPrompt(null);
    if (choice === 'cancel') return;
    if (choice === 'save' && !(await save())) return;
    await openProject();
  }, [openProject, prompt, save, showToast]);

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
        <aside className="panel layers-panel" aria-label="Elementos do jogo">
          <div className="panel-heading">
            <div><span className="eyebrow">PROJETO</span><h1>Elementos</h1></div>
            <span className="count-pill">{elements.length}</span>
          </div>
          <p className="panel-intro">Selecione um item aqui ou clique nele diretamente na prévia.</p>
          {elements.length > 0 ? (
            <div className="layer-list" role="listbox" aria-label="Elementos registrados">
              {elements.map((element, index) => (
                <button key={element.id} className={`layer-item ${selectedId === element.id ? 'selected' : ''}`} onClick={() => { setSelectedId(element.id); setMode('edit'); }} role="option" aria-selected={selectedId === element.id}>
                  <span className={`layer-icon kind-${element.kind}`} aria-hidden="true">{element.kind === 'text' ? 'T' : element.kind === 'image' ? '▧' : element.kind === 'button' ? '▰' : element.kind === 'meter' ? '▥' : '▢'}</span>
                  <span className="layer-copy"><strong>{prettyName(element)}</strong><small>{KIND_LABELS[element.kind] || element.kind}</small></span>
                  <span className="layer-index">{String(index + 1).padStart(2, '0')}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-panel"><div className="empty-icon">▱</div><strong>Abra um projeto</strong><p>Escolha a pasta do jogo para carregar os elementos editáveis.</p><button className="text-button" onClick={() => void openProject()}>Selecionar pasta</button></div>
          )}
          <div className="layers-footnote"><span className="dot dot-violet" />Os elementos seguem o catálogo oficial do projeto.</div>
        </aside>

        <section className="canvas-column" aria-label="Prévia do jogo">
          <div className="canvas-toolbar">
            <div className="canvas-title"><span className="canvas-title-icon">◫</span><div><strong>Pré-visualização</strong><small>{mode === 'edit' ? 'Clique no jogo para selecionar' : 'Jogue normalmente nesta prévia'}</small></div></div>
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
                  key={project.session}
                  className={`game-preview ${mode === 'edit' ? 'editing' : 'testing'}`}
                  title="Prévia interativa do jogo Pedra, Papel e Tesoura"
                  src={project.previewUrl}
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

      {prompt && <div className="modal-backdrop" role="presentation"><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><div className="modal-icon">{prompt === 'close' ? '↗' : '▱'}</div><h2 id="confirm-title">{prompt === 'close' ? 'Há alterações não salvas' : 'Salvar antes de abrir outro projeto?'}</h2><p>{prompt === 'close' ? 'Suas últimas mudanças ainda não foram gravadas no projeto.' : 'Você pode salvar as alterações atuais antes de escolher outra pasta.'}</p><div className="modal-actions"><button className="button button-quiet" onClick={() => void answerPrompt('cancel')}>{prompt === 'close' ? 'Continuar editando' : 'Cancelar'}</button><button className="button button-quiet" onClick={() => void answerPrompt('discard')}>{prompt === 'close' ? 'Descartar' : 'Descartar alterações'}</button><button className="button button-primary" onClick={() => void answerPrompt('save')}>Salvar</button></div></section></div>}
    </div>
  );
}
