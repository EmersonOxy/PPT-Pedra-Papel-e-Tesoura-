import { GameApp } from './ui/game-app.ts';
import './ui/home.css';
import './ui/styles.css';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Elemento raiz da aplicação não encontrado.');

new GameApp(root);
