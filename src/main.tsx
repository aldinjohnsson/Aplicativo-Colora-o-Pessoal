import { Component, StrictMode } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Se um deploy novo aconteceu enquanto essa aba estava aberta, os hashes
// dos arquivos JS mudaram — um import dinâmico pode tentar buscar um arquivo
// da build antiga que não existe mais. O Vite dispara 'vite:preloadError'
// nesse caso. Recarrega UMA vez (trava em sessionStorage para não entrar em
// loop de reload caso o erro persista).
window.addEventListener('vite:preloadError', () => {
  try {
    if (sessionStorage.getItem('preload-reloaded') === '1') return;
    sessionStorage.setItem('preload-reloaded', '1');
  } catch {
    // sessionStorage indisponível (modo privado/bloqueio): recarrega mesmo assim
  }
  window.location.reload();
});

// Evita a "tela branca": se qualquer componente lançar erro ao renderizar,
// mostra a mensagem em vez de derrubar a árvore inteira do React.
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
        <h1 style={{ fontSize: 18, marginBottom: 8 }}>Algo deu errado ao abrir a página</h1>
        <p style={{ color: '#555', marginBottom: 12 }}>
          Tente recarregar. Se continuar, envie esta mensagem ao suporte:
        </p>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12, color: '#b00' }}>
          {String(this.state.error.message || this.state.error)}
        </pre>
        <button
          onClick={() => window.location.reload()}
          style={{ marginTop: 12, padding: '8px 16px' }}
        >
          Recarregar
        </button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);