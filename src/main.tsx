// Polyfill do Iterator global (iterator helpers). Precisa ser o PRIMEIRO
// import: o Safari/iOS anterior ao 18.4 não tem `Iterator` e libs como o
// pdfjs-dist@6 quebram no carregamento com "Can't find variable: Iterator".
import 'core-js/actual/iterator';
import { Component, StrictMode } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Definido pelo monitor de erros no index.html (grava em client_errors).
declare global {
  interface Window {
    __reportClientError?: (message: string, stack?: string) => void;
  }
}

// Se um deploy novo aconteceu enquanto essa aba estava aberta, os hashes
// dos arquivos JS mudaram — um import dinâmico pode tentar buscar um arquivo
// da build antiga que não existe mais. O Vite dispara 'vite:preloadError'
// nesse caso. Recarrega UMA vez (trava em sessionStorage para não entrar em
// loop de reload caso o erro persista).
window.addEventListener('vite:preloadError', () => {
  window.__reportClientError?.('vite:preloadError (arquivo de build antiga não encontrado)');
  try {
    if (sessionStorage.getItem('preload-reloaded') === '1') return;
    sessionStorage.setItem('preload-reloaded', '1');
  } catch {
    // sessionStorage indisponível (modo privado/bloqueio): recarrega mesmo assim
  }
  window.location.reload();
});

// Evita a "tela branca": se qualquer componente lançar erro ao renderizar,
// mostra a mensagem em vez de derrubar a árvore inteira do React e registra
// o erro no monitor.
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
    window.__reportClientError?.(
      String(error.message || error),
      (error.stack || '') + '\n' + (info.componentStack || '')
    );
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