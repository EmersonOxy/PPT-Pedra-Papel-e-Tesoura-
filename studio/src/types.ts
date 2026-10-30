export type PropertyType = 'text' | 'color' | 'imageAsset' | 'fontFamily' | 'fontSize' | 'fontWeight' | 'textAlign' | 'opacity' | 'boolean';
export type Binding =
  | { operation: 'textContent' }
  | { operation: 'styleVariable'; name: string }
  | { operation: 'firstChildBackground' }
  | { operation: 'imageSource' }
  | { operation: 'visibility' };

export interface EditorProperty {
  key: string;
  type: PropertyType;
  default: string | number | boolean;
  binding: Binding;
  maxLength?: number;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<string | number>;
  optional?: boolean;
  responsive: boolean;
}

export interface EditorElement {
  id: string;
  kind: string;
  labelKey: string;
  target: { attribute: 'data-editor-id' };
  properties: EditorProperty[];
  geometry?: {
    type: 'flow-box-v1';
    binding: 'css-flow-box-v1';
    anchor: 'flow';
    default: Record<string, number>;
    supports: Array<'move' | 'resize'>;
    units: 'css-px';
    responsive: boolean;
    limits: Record<'x' | 'y' | 'width' | 'height', { min: number; max: number }>;
  };
}

export interface EditorCatalog {
  version: number;
  elements: EditorElement[];
}

export interface VisualConfig {
  schemaVersion: number;
  elements: Record<string, {
    base?: Record<string, string | number | boolean>;
    responsive?: Record<string, Record<string, string | number | boolean>>;
    geometry?: { base?: Record<string, number>; responsive?: Record<string, Record<string, number>> };
  }>;
}

export interface ProjectPayload {
  ok: boolean;
  error?: string;
  canceled?: boolean;
  name?: string;
  catalog?: EditorCatalog;
  config?: VisualConfig;
  assets?: ImageAsset[];
  previewUrl?: string;
  session?: string;
  protocol?: number;
  root?: string;
}

export interface ImageAsset {
  id: string;
  name: string;
  file: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  size: number;
  width: number;
  height: number;
  sha256: string;
}

export interface ImportImageResult {
  ok: boolean;
  canceled?: boolean;
  asset?: ImageAsset;
  assets?: ImageAsset[];
  reused?: boolean;
}

export interface RecentProject {
  id: string;
  name: string;
  root: string;
  projectFormatVersion: number;
  lastOpenedAt: string;
  unavailable?: boolean;
  needsImport?: boolean;
}

export interface ProjectTemplate {
  id: string;
  label: string;
  description: string;
  version: string;
  engineId: string;
  available: boolean;
}

export interface StudioHomeState {
  appVersion: string;
  projectsDirectory: string;
  recentProjects: RecentProject[];
  templates: ProjectTemplate[];
  updateChannel: 'stable';
}

export interface UpdateCheckResult {
  state: 'up-to-date' | 'available' | 'local-ahead' | 'offline' | 'error';
  currentVersion: string;
  latestVersion?: string;
  notes?: string;
  pageUrl?: string;
  installerName?: string;
  publishedAt?: string | null;
  message?: string;
}

export interface TrindadeStudioApi {
  getProject: () => Promise<ProjectPayload>;
  openProject: () => Promise<ProjectPayload>;
  getHomeState: () => Promise<StudioHomeState>;
  chooseProjectParent: () => Promise<{ canceled?: boolean; path?: string }>;
  createProject: (request: { name: string; templateId: string }) => Promise<ProjectPayload>;
  openRecentProject: (root: string) => Promise<ProjectPayload>;
  removeRecentProject: (root: string) => Promise<{ ok: boolean; recentProjects: RecentProject[] }>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
  openReleasePage: (url: string) => Promise<{ ok: boolean }>;
  requestHome: () => Promise<{ ok: boolean }>;
  saveVisualConfig: (config: VisualConfig) => Promise<{ ok: boolean; config?: VisualConfig; backupName?: string }>;
  importImage: () => Promise<ImportImageResult>;
  getAssetPreview: (assetId: string) => Promise<string>;
  setDirty: (dirty: boolean) => Promise<{ ok: boolean }>;
  respondToClose: (choice: 'save' | 'discard' | 'cancel') => Promise<{ ok: boolean; needsSave?: boolean }>;
  closeStudio: () => Promise<{ ok: boolean }>;
  onSaveRequest: (callback: () => void) => () => void;
  onOpenProjectRequest: (callback: () => void) => () => void;
  onHistoryCommand: (callback: (command: 'undo' | 'redo') => void) => () => void;
  onCloseRequest: (callback: () => void) => () => void;
  onReturnHomeRequest: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    trindadeStudio: TrindadeStudioApi;
  }
}
