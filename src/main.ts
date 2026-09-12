import './ui/styles/haxball.css';
import { GameApp } from './client/GameApp';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (m) => {
    switch (m) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return m;
    }
  });
}

export function renderErrorBoundary(error: unknown): void {
  console.error('[Haxball Fatal Error]', error);

  if (typeof document === 'undefined') return;
  if (document.getElementById('fatal-error-boundary')) return;

  const stack = error instanceof Error ? (error.stack || error.message) : String(error);

  const container = document.createElement('div');
  container.id = 'fatal-error-boundary';
  container.style.cssText = `
    position: fixed;
    inset: 0;
    background-color: #111;
    color: #f87171;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    padding: 24px;
    z-index: 999999;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    box-sizing: border-box;
    overflow-y: auto;
  `;

  container.innerHTML = `
    <div style="max-width: 680px; width: 100%; background: #181818; border: 1px solid #ef4444; border-radius: 8px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.85); box-sizing: border-box;">
      <h1 style="font-size: 1.25rem; font-weight: 700; color: #ef4444; margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px;">
        ⚠️ Error Crítico de Inicialización
      </h1>
      <p style="color: #94a3b8; font-size: 0.85rem; margin: 0 0 16px 0; line-height: 1.4;">
        Se ha producido una excepción no controlada durante el arranque de BallHax.
      </p>
      <pre style="background: #0d0d0d; color: #fca5a5; padding: 12px; border-radius: 6px; font-size: 0.78rem; overflow-x: auto; white-space: pre-wrap; word-break: break-word; border: 1px solid #2f2f2f; max-height: 240px; margin: 0 0 18px 0; line-height: 1.4;">${escapeHtml(stack)}</pre>
      <button id="btn-reset-app" style="background: #ef4444; color: #ffffff; border: none; border-radius: 6px; padding: 10px 18px; font-weight: 700; font-family: inherit; font-size: 0.85rem; cursor: pointer; transition: opacity 0.15s ease;">
        🔄 Restablecer Datos y Recargar
      </button>
    </div>
  `;

  document.body.appendChild(container);

  const resetBtn = document.getElementById('btn-reset-app');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      localStorage.clear();
      location.reload();
    });
  }
}

async function initApp(): Promise<void> {
  try {
    const app = new GameApp();
    (window as any).__HAXBALL_APP__ = app;
  } catch (err) {
    renderErrorBoundary(err);
  }
}

// Global listeners for early boot errors
window.addEventListener('error', (event) => {
  if (!(window as any).__HAXBALL_APP__) {
    renderErrorBoundary(event.error || event.message);
  }
});

window.addEventListener('unhandledrejection', (event) => {
  if (!(window as any).__HAXBALL_APP__) {
    renderErrorBoundary(event.reason);
  }
});

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => {
    initApp().catch(renderErrorBoundary);
  });
} else {
  initApp().catch(renderErrorBoundary);
}
