export type PropertyType = 'text' | 'color' | 'imageAsset';
export type Binding =
  | { operation: 'textContent' }
  | { operation: 'styleVariable'; name: string }
  | { operation: 'firstChildBackground' }
  | { operation: 'imageSource' };

export interface EditorProperty {
  key: string;
  type: PropertyType;
  default: string;
  binding: Binding;
  maxLength?: number;
  responsive: boolean;
}

export interface EditorElement {
  id: string;
  kind: string;
  labelKey: string;
  target: { attribute: 'data-editor-id' };
  properties: EditorProperty[];
}

export interface EditorCatalog {
  version: number;
  elements: EditorElement[];
}

export interface VisualConfig {
  schemaVersion: number;
  elements: Record<string, {
    base: Record<string, string>;
    responsive?: Record<string, Record<string, string>>;
  }>;
}

export interface ProjectPayload {
  ok: boolean;
  error?: string;
  canceled?: boolean;
  name?: string;
  catalog?: EditorCatalog;
  config?: VisualConfig;
  previewUrl?: string;
  session?: string;
  protocol?: number;
}

export interface TrindadeStudioApi {
  getProject: () => Promise<ProjectPayload>;
  openProject: () => Promise<ProjectPayload>;
  saveVisualConfig: (config: VisualConfig) => Promise<{ ok: boolean; config?: VisualConfig; backupName?: string }>;
  setDirty: (dirty: boolean) => Promise<{ ok: boolean }>;
  respondToClose: (choice: 'save' | 'discard' | 'cancel') => Promise<{ ok: boolean; needsSave?: boolean }>;
  closeStudio: () => Promise<{ ok: boolean }>;
  onSaveRequest: (callback: () => void) => () => void;
  onOpenProjectRequest: (callback: () => void) => () => void;
  onHistoryCommand: (callback: (command: 'undo' | 'redo') => void) => () => void;
  onCloseRequest: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    trindadeStudio: TrindadeStudioApi;
  }
}
