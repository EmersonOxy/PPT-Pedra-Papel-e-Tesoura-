const { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createPreviewServer } = require('./preview-server.cjs');
const { createStaticServer, createContentSecurityPolicy } = require('./renderer-server.cjs');
const { importImageAt, loadProjectAt, readRegisteredAssetAt, saveVisualConfigAt } = require('./project-service.cjs');
const { TEMPLATES, addRecentProject, createDuplicate, createProject, ensureManifest, getTemplate, isGitWorkingTree, listRecentProjects, removeRecentProject } = require('./project-library.cjs');
const { STABLE_RELEASE_PAGE, createUpdateService, isOfficialReleasePage } = require('./update-service.cjs');

const updateService = createUpdateService();

if (process.env.TRINDADE_STUDIO_TEST_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.TRINDADE_STUDIO_TEST_USER_DATA));
}
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

const studioDirectory = path.resolve(__dirname, '..');
let mainWindow = null;
let project = null;
let projectRoot = null;
let previewOrigin = '';
let rendererOrigin = '';
let previewSession = '';
let isDirty = false;
let closePending = false;
let allowClose = false;
let viteServer = null;
let staticServer = null;
let previewServer = null;
let startupMessage = null;
let projectParentSelection = null;

if (process.env.TRINDADE_STUDIO_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.TRINDADE_STUDIO_DEBUG_PORT);

function makePayload() {
  if (!project || !previewOrigin || !previewSession) {
    return { ok: false, error: startupMessage || 'Abra uma pasta de projeto para carregar a prévia.' };
  }
  const query = new URLSearchParams({ studioSession: previewSession, studioParent: rendererOrigin }).toString();
  return {
    ok: true,
    name: project.name,
    catalog: project.catalog,
    config: project.config,
    assets: project.assets || [],
    previewUrl: `${previewOrigin}/?${query}`,
    session: previewSession,
    protocol: 1,
    root: projectRoot,
  };
}

function assertRenderer(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error('Operação recusada: remetente do Studio inválido.');
  }
  let senderOrigin;
  try { senderOrigin = new URL(event.senderFrame.url).origin; } catch { senderOrigin = ''; }
  if (senderOrigin !== rendererOrigin) throw new Error('Operação recusada: origem do Studio inválida.');
}

async function decodeImageInStudioRenderer(bytes, mimeType, { thumbnail = false } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('O Studio precisa estar aberto para validar a imagem.');
  const dataUrl = `data:${mimeType};base64,${bytes.toString('base64')}`;
  const expression = `new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const result = { width: image.naturalWidth, height: image.naturalHeight };
      if (${thumbnail}) {
        const scale = Math.min(128 / result.width, 128 / result.height, 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(result.width * scale));
        canvas.height = Math.max(1, Math.round(result.height * scale));
        const context = canvas.getContext('2d', { alpha: true });
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        result.thumbnail = canvas.toDataURL('image/png');
      }
      resolve(result);
    };
    image.onerror = () => resolve(null);
    image.src = ${JSON.stringify(dataUrl)};
  })`;
  return mainWindow.webContents.executeJavaScript(expression, true);
}

async function canonicalProject(root) {
  return loadProjectAt(root);
}

async function locateStartupProject() {
  if (process.env.TRINDADE_STUDIO_TEST_HOME === '1') return null;
  if (process.env.TRINDADE_STUDIO_TEST_MODE === '1' && process.env.TRINDADE_PROJECT_ROOT) {
    return process.env.TRINDADE_PROJECT_ROOT;
  }
  if (!app.isPackaged) return process.env.TRINDADE_PROJECT_ROOT || path.resolve(studioDirectory, '..', 'games', 'pedra-papel-tesoura');
  return null;
}

function projectsDirectory() {
  if (process.env.TRINDADE_STUDIO_TEST_MODE === '1' && process.env.TRINDADE_STUDIO_TEST_PROJECTS_DIR) {
    return path.resolve(process.env.TRINDADE_STUDIO_TEST_PROJECTS_DIR);
  }
  return path.join(app.getPath('documents'), 'TrindadeProjetos');
}

function templateDirectory() {
  return app.isPackaged ? path.join(process.resourcesPath, 'game-template') : path.resolve(studioDirectory, '..', 'games', 'pedra-papel-tesoura');
}

async function setProject(root, manifest = null) {
  const next = await canonicalProject(root);
  const projectManifest = manifest || await ensureManifest(next.root, { userData: app.getPath('userData') });
  if (!projectManifest) throw new Error('O projeto precisa ser importado antes de abrir no Studio.');
  project = next;
  project.manifest = projectManifest;
  project.name = projectManifest.name || next.name;
  projectRoot = next.root;
  previewSession = crypto.randomBytes(32).toString('hex');
  previewServer?.setProjectRoot(projectRoot);
  isDirty = false;
  closePending = false;
  if (rendererOrigin) await addRecentProject(app.getPath('userData'), projectRoot, projectManifest, project.name).catch(() => {});
  return makePayload();
}

async function openProjectRoot(selectedRoot, { duplicateIfGit = false } = {}) {
  const loaded = await canonicalProject(selectedRoot);
  const inGit = await isGitWorkingTree(loaded.root);
  let targetRoot = loaded.root;
  let manifest = null;
  if (inGit && duplicateIfGit) {
    const defaultParent = projectsDirectory();
    await fs.mkdir(defaultParent, { recursive: true });
    const result = await createDuplicate({
      sourceRoot: loaded.root,
      parentDirectory: defaultParent,
      name: loaded.name,
      templateRoot: templateDirectory(),
      userData: app.getPath('userData'),
    });
    targetRoot = result.root;
    manifest = result.manifest;
  } else {
    const currentManifest = await ensureManifest(loaded.root, { userData: app.getPath('userData') });
    if (!currentManifest) {
      const answer = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Importar projeto existente',
        message: 'Esta pasta ainda não tem um manifesto do Trindade Studio.',
        detail: 'O Studio criará uma cópia de segurança dos arquivos do jogo no perfil do usuário antes de adicionar o manifesto. Mecânicas e assets não serão alterados.',
        buttons: ['Criar backup e importar', 'Cancelar'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (answer.response !== 0) return { ok: false, canceled: true };
      manifest = await ensureManifest(loaded.root, { userData: app.getPath('userData'), confirmImport: true });
    } else manifest = currentManifest;
  }
  return setProject(targetRoot, manifest);
}

async function openProjectDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Abrir projeto do Trindade',
    properties: ['openDirectory'],
    buttonLabel: 'Abrir projeto',
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
  try {
    const selectedRoot = result.filePaths[0];
    const loaded = await canonicalProject(selectedRoot);
    if (await isGitWorkingTree(loaded.root)) {
      const answer = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Pasta dentro de repositório Git',
        message: 'Esta pasta pertence a um repositório Git ou worktree.',
        detail: 'Editar o projeto original pode alterar arquivos rastreados. Você pode duplicar somente os arquivos do jogo para TrindadeProjetos e manter o repositório intacto.',
        buttons: ['Duplicar para TrindadeProjetos', 'Abrir esta pasta', 'Cancelar'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });
      if (answer.response === 2) return { ok: false, canceled: true };
      return openProjectRoot(selectedRoot, { duplicateIfGit: answer.response === 0 });
    }
    return openProjectRoot(selectedRoot);
  } catch (error) {
    return { ok: false, error: `Não foi possível abrir essa pasta. ${error.message}` };
  }
}

async function chooseProjectParent() {
  const defaultPath = projectParentSelection || projectsDirectory();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Escolher localização dos projetos',
    defaultPath,
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Usar esta pasta',
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const root = await fs.realpath(result.filePaths[0]);
  projectParentSelection = root;
  return { canceled: false, path: root };
}

async function makeNewProject(name, templateId) {
  const parent = projectParentSelection || projectsDirectory();
  await fs.mkdir(parent, { recursive: true });
  const result = await createProject({ name, parentDirectory: parent, templateRoot: templateDirectory(), templateId });
  projectParentSelection = null;
  return setProject(result.root, result.manifest);
}

async function installIpc() {
  ipcMain.handle('studio:get-project', (event) => {
    assertRenderer(event);
    if (!project && startupMessage) return { ok: false, error: startupMessage };
    return makePayload();
  });
  ipcMain.handle('studio:open-project', async (event) => {
    assertRenderer(event);
    return openProjectDialog();
  });
  ipcMain.handle('studio:get-home-state', async (event) => {
    assertRenderer(event);
    return {
      appVersion: app.getVersion(),
      projectsDirectory: projectsDirectory(),
      recentProjects: await listRecentProjects(app.getPath('userData')),
      templates: TEMPLATES,
      updateChannel: 'stable',
    };
  });
  ipcMain.handle('studio:choose-project-parent', async (event) => {
    assertRenderer(event);
    return chooseProjectParent();
  });
  ipcMain.handle('studio:create-project', async (event, request) => {
    assertRenderer(event);
    if (!request || !getTemplate(request.templateId)) throw new Error('O modelo de projeto selecionado não é suportado.');
    return makeNewProject(request.name, request.templateId);
  });
  ipcMain.handle('studio:open-recent-project', async (event, root) => {
    assertRenderer(event);
    const recent = (await listRecentProjects(app.getPath('userData'))).find((entry) => entry.root === root);
    if (!recent) throw new Error('O projeto não está na lista recente. Use Abrir projeto para selecionar uma pasta.');
    try {
      const loaded = await canonicalProject(recent.root);
      if (await isGitWorkingTree(loaded.root)) {
        const answer = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Pasta dentro de repositório Git',
          message: 'Este projeto recente pertence a um repositório Git ou worktree.',
          detail: 'Você pode duplicar somente os arquivos do jogo para TrindadeProjetos e manter o repositório intacto.',
          buttons: ['Duplicar para TrindadeProjetos', 'Abrir esta pasta', 'Cancelar'],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        });
        if (answer.response === 2) return { ok: false, canceled: true };
        return openProjectRoot(recent.root, { duplicateIfGit: answer.response === 0 });
      }
      return openProjectRoot(recent.root);
    } catch (error) {
      return { ok: false, error: `Não foi possível abrir o projeto recente. ${error.message}` };
    }
  });
  ipcMain.handle('studio:remove-recent-project', async (event, root) => {
    assertRenderer(event);
    if (typeof root !== 'string') throw new Error('Entrada de projeto inválida.');
    const recent = (await listRecentProjects(app.getPath('userData'))).find((entry) => entry.root === root);
    if (!recent) return { ok: true, recentProjects: await listRecentProjects(app.getPath('userData')) };
    await removeRecentProject(app.getPath('userData'), root);
    return { ok: true, recentProjects: await listRecentProjects(app.getPath('userData')) };
  });
  ipcMain.handle('studio:check-updates', async (event) => {
    assertRenderer(event);
    return updateService.check(app.getVersion());
  });
  ipcMain.handle('studio:open-release-page', async (event, url) => {
    assertRenderer(event);
    if (!isOfficialReleasePage(url)) throw new Error('A página de atualização não pertence ao repositório oficial.');
    await shell.openExternal(url);
    return { ok: true };
  });
  ipcMain.handle('studio:save-visual-config', async (event, candidate) => {
    assertRenderer(event);
    if (!project || !projectRoot || !candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('Não há uma configuração válida para salvar.');
    }
    const result = await saveVisualConfigAt(projectRoot, project.catalog, candidate);
    project.config = result.config;
    isDirty = false;
    return { ok: true, config: result.config, backupName: path.basename(result.backupPath) };
  });
  ipcMain.handle('studio:import-image', async (event) => {
    assertRenderer(event);
    if (!project || !projectRoot) throw new Error('Abra um projeto antes de importar imagens.');
    let selectedPath = '';
    if (process.env.TRINDADE_STUDIO_TEST_MODE === '1' && process.env.TRINDADE_STUDIO_TEST_IMPORT_PATH) {
      selectedPath = path.resolve(process.env.TRINDADE_STUDIO_TEST_IMPORT_PATH);
    } else {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Importar imagem para este projeto',
        properties: ['openFile'],
        buttonLabel: 'Importar imagem',
        filters: [{ name: 'Imagens raster estáticas', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      });
      if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true, assets: project.assets || [] };
      selectedPath = result.filePaths[0];
    }
    const imported = await importImageAt(projectRoot, selectedPath, {
      validateDecoded: async (bytes, details) => {
        let dimensions;
        if (details.format === 'webp') dimensions = await decodeImageInStudioRenderer(bytes, details.mimeType);
        else {
          const image = nativeImage.createFromBuffer(bytes);
          if (!image.isEmpty()) dimensions = image.getSize();
        }
        if (!dimensions || dimensions.width !== details.width || dimensions.height !== details.height) {
          throw new Error('O runtime do Electron não conseguiu decodificar a imagem selecionada.');
        }
      },
    });
    project.assets = imported.assets;
    return { ok: true, asset: imported.asset, assets: imported.assets, reused: imported.reused === true };
  });
  ipcMain.handle('studio:get-asset-preview', async (event, assetId) => {
    assertRenderer(event);
    if (!project || !projectRoot) throw new Error('Abra um projeto antes de visualizar imagens.');
    const result = await readRegisteredAssetAt(projectRoot, assetId);
    const image = nativeImage.createFromBuffer(result.body);
    if (!image.isEmpty()) return image.resize({ width: 128 }).toDataURL();
    const decoded = await decodeImageInStudioRenderer(result.body, result.asset.mimeType, { thumbnail: true });
    if (!decoded?.thumbnail) throw new Error('A imagem registrada não pôde ser decodificada para a miniatura.');
    return decoded.thumbnail;
  });
  ipcMain.handle('studio:set-dirty', (event, dirty) => {
    assertRenderer(event);
    if (typeof dirty !== 'boolean') throw new Error('Estado de edição inválido.');
    isDirty = dirty;
    return { ok: true };
  });
  ipcMain.handle('studio:respond-to-close', (event, choice) => {
    assertRenderer(event);
    if (!closePending || !['save', 'discard', 'cancel'].includes(choice)) return { ok: false };
    if (choice === 'cancel' || (choice === 'save' && isDirty)) {
      closePending = false;
      return { ok: choice === 'cancel', needsSave: choice === 'save' };
    }
    closePending = false;
    allowClose = true;
    mainWindow?.close();
    return { ok: true };
  });
  ipcMain.handle('studio:request-close', (event) => {
    assertRenderer(event);
    mainWindow?.close();
    return { ok: true };
  });
  ipcMain.handle('studio:request-home', (event) => {
    assertRenderer(event);
    mainWindow?.webContents.send('studio:return-home-request');
    return { ok: true };
  });
}

function buildMenu() {
  const template = [
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Central de projetos', accelerator: 'Ctrl+Shift+H', click: () => mainWindow?.webContents.send('studio:return-home-request') },
        { label: 'Abrir projeto…', accelerator: 'Ctrl+O', click: () => mainWindow?.webContents.send('studio:open-project-request') },
        { type: 'separator' },
        { label: 'Sair', accelerator: 'Alt+F4', click: () => mainWindow?.close() },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { label: 'Desfazer', accelerator: 'Ctrl+Z', click: () => mainWindow?.webContents.send('studio:history-command', 'undo') },
        { label: 'Refazer', accelerator: 'Ctrl+Shift+Z', click: () => mainWindow?.webContents.send('studio:history-command', 'redo') },
        { type: 'separator' },
        { label: 'Salvar', accelerator: 'Ctrl+S', click: () => mainWindow?.webContents.send('studio:save-request') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function startRenderer() {
  if (app.isPackaged) {
    const root = path.resolve(studioDirectory, 'dist');
    staticServer = createStaticServer(root, () => previewOrigin);
    const url = await staticServer.listen();
    rendererOrigin = new URL(url).origin;
    return url;
  }
  const { createServer } = await import('vite');
  const cspPlugin = {
    name: 'trindade-studio-development-csp',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        response.setHeader('Content-Security-Policy', createContentSecurityPolicy(previewOrigin, true, rendererOrigin));
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Referrer-Policy', 'no-referrer');
        next();
      });
    },
  };
  viteServer = await createServer({
    configFile: path.join(studioDirectory, 'vite.config.ts'),
    plugins: [cspPlugin],
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await viteServer.listen();
  const address = viteServer.httpServer.address();
  const url = `http://127.0.0.1:${address.port}`;
  rendererOrigin = new URL(url).origin;
  return url;
}

async function createWindow(rendererUrl) {
  const testWindowHidden = process.env.TRINDADE_STUDIO_TEST_HIDDEN === '1';
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    offscreen: testWindowHidden,
    title: 'Trindade Studio',
    backgroundColor: '#f4f2ee',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    let origin;
    try { origin = new URL(url).origin; } catch { origin = ''; }
    if (origin !== rendererOrigin) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.on('close', (event) => {
    if (allowClose || !isDirty) return;
    event.preventDefault();
    if (closePending) return;
    closePending = true;
    mainWindow.webContents.send('studio:close-request');
  });
  mainWindow.once('ready-to-show', () => {
    if (!testWindowHidden) mainWindow.show();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  await mainWindow.loadURL(rendererUrl);
  return mainWindow;
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  try {
    projectRoot = await locateStartupProject();
    try {
      project = await loadProjectAt(projectRoot);
      projectRoot = project.root;
      previewSession = crypto.randomBytes(32).toString('hex');
    } catch (error) {
      startupMessage = `Não foi possível carregar o projeto inicial. ${error.message}`;
      project = null;
      projectRoot = null;
    }

    const rendererUrl = await startRenderer();
    previewServer = createPreviewServer(projectRoot, () => rendererOrigin, () => previewSession);
    previewOrigin = await previewServer.listen();
    await installIpc();
    buildMenu();
    await createWindow(rendererUrl);
  } catch (error) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Trindade Studio não iniciou',
      message: 'Não foi possível abrir o Studio.',
      detail: error.message,
    });
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (event) => {
  if (isDirty && !allowClose) {
    event.preventDefault();
    mainWindow?.close();
    return;
  }
  await Promise.allSettled([previewServer?.close(), staticServer?.close(), viteServer?.close()]);
});
