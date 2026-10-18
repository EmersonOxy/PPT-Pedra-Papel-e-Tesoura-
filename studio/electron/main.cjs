const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createPreviewServer } = require('./preview-server.cjs');
const { createStaticServer, createContentSecurityPolicy } = require('./renderer-server.cjs');
const { allowedFiles, loadProjectAt, saveVisualConfigAt } = require('./project-service.cjs');

if (process.env.TRINDADE_STUDIO_TEST_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.TRINDADE_STUDIO_TEST_USER_DATA));
}
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

const studioDirectory = path.resolve(__dirname, '..');
const projectTemplateFiles = [...allowedFiles];
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

if (process.env.TRINDADE_STUDIO_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.TRINDADE_STUDIO_DEBUG_PORT);

function makePayload() {
  if (!project || !previewOrigin || !previewSession) {
    return { ok: false, error: startupMessage || 'Abra uma pasta de projeto para carregar a prévia.' };
  }
  const query = new URLSearchParams({ studioSession: previewSession }).toString();
  return {
    ok: true,
    name: project.name,
    catalog: project.catalog,
    config: project.config,
    previewUrl: `${previewOrigin}/?${query}`,
    session: previewSession,
    protocol: 1,
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

async function canonicalProject(root) {
  const loaded = await loadProjectAt(root);
  return loaded;
}

async function copyProjectTemplate(templateRoot, destinationRoot) {
  const root = path.resolve(destinationRoot);
  if (root === path.parse(root).root) throw new Error('O destino do modelo não é válido.');
  for (const relative of projectTemplateFiles) {
    const source = path.resolve(templateRoot, relative);
    const destination = path.resolve(root, relative);
    if (!source.startsWith(path.resolve(templateRoot) + path.sep) || !destination.startsWith(root + path.sep)) {
      throw new Error('O modelo contém um caminho fora da pasta do projeto.');
    }
    const sourceInfo = await fs.lstat(source);
    if (sourceInfo.isSymbolicLink() || !sourceInfo.isFile()) throw new Error(`O modelo contém um arquivo inválido: ${relative}`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination, require('node:fs').constants.COPYFILE_EXCL);
  }
}

async function settingsPath() {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  return path.join(app.getPath('userData'), 'studio-settings.json');
}

async function readLastProject() {
  try {
    const settings = JSON.parse(await fs.readFile(await settingsPath(), 'utf8'));
    return typeof settings.lastProjectRoot === 'string' ? settings.lastProjectRoot : null;
  } catch {
    return null;
  }
}

async function rememberProject(root) {
  const file = await settingsPath();
  const temp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ lastProjectRoot: root }), { flag: 'wx', mode: 0o600 });
  await fs.rename(temp, file);
}

async function locateStartupProject() {
  if (process.env.TRINDADE_STUDIO_TEST_MODE === '1' && process.env.TRINDADE_PROJECT_ROOT) {
    return process.env.TRINDADE_PROJECT_ROOT;
  }
  if (!app.isPackaged) {
    if (process.env.TRINDADE_PROJECT_ROOT) return process.env.TRINDADE_PROJECT_ROOT;
    return path.resolve(studioDirectory, '..');
  }
  const lastRoot = await readLastProject();
  if (lastRoot) return lastRoot;
  const documents = app.getPath('documents');
  const defaultRoot = path.join(documents, 'Trindade Studio', 'Projetos', 'Pedra-Papel-e-Tesoura');
  try {
    await fs.access(path.join(defaultRoot, 'index.html'));
    return defaultRoot;
  } catch {
    const templateRoot = path.join(process.resourcesPath, 'game-template');
    await copyProjectTemplate(templateRoot, defaultRoot);
    return defaultRoot;
  }
}

async function setProject(root) {
  const next = await canonicalProject(root);
  project = next;
  projectRoot = next.root;
  previewSession = crypto.randomBytes(32).toString('hex');
  previewServer?.setProjectRoot(projectRoot);
  isDirty = false;
  closePending = false;
  if (rendererOrigin) await rememberProject(projectRoot).catch(() => {});
  return makePayload();
}

async function openProjectDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Abrir projeto do Trindade',
    properties: ['openDirectory'],
    buttonLabel: 'Abrir projeto',
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
  try {
    return await setProject(result.filePaths[0]);
  } catch (error) {
    return { ok: false, error: `Não foi possível abrir essa pasta. ${error.message}` };
  }
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
}

function buildMenu() {
  const template = [
    {
      label: 'Arquivo',
      submenu: [
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
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    show: false,
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
  mainWindow.once('ready-to-show', () => mainWindow.show());
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
    previewServer = createPreviewServer(projectRoot, () => rendererOrigin);
    previewOrigin = await previewServer.listen();
    await installIpc();
    buildMenu();
    await createWindow(rendererUrl);
    if (projectRoot) await rememberProject(projectRoot).catch(() => {});
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
