import './ui/styles/haxball.css';
import { GameApp } from './client/GameApp';

function initApp(): void {
  try {
    const app = new GameApp();
    (window as any).__HAXBALL_APP__ = app;
  } catch (err) {
    console.error('[GameApp] Critical initialization error:', err);
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
