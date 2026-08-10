import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Se um deploy novo aconteceu enquanto essa aba estava aberta, os hashes
// dos arquivos JS mudaram — um import dinâmico (ex: jszip pro "Baixar Tudo
// ZIP") pode tentar buscar um arquivo da build antiga que já não existe
// mais no servidor, cair no rewrite do vercel.json e receber o index.html
// (text/html) em vez do JS esperado. O Vite dispara 'vite:preloadError'
// exatamente nesse caso — recarrega a página uma vez pra pegar a build
// atual, sem precisar orientar ninguém a dar Ctrl+Shift+R manualmente.
window.addEventListener('vite:preloadError', () => {
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);