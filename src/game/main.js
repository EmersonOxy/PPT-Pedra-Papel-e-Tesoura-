import { loadVisualConfig } from './ui/visual-config.js';

await loadVisualConfig();
await import('./ui/game-ui.js');
