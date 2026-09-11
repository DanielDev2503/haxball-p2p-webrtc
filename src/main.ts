import './ui/styles/haxball.css';
import { GameApp } from './client/GameApp';

window.addEventListener('DOMContentLoaded', () => {
  const app = new GameApp();
  (window as any).__HAXBALL_APP__ = app;
});
