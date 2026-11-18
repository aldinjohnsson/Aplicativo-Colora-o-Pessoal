import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    // Transpila sintaxe moderna (?. e ??) para Safari/iOS mais antigos.
    target: 'es2019',
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    // ANTES: JSON.stringify(process.env) -> copiava TODAS as variáveis da
    // máquina de build para o JS público (vazamento de segredos).
    // Agora fica um objeto vazio: libs que lerem process.env.X não quebram,
    // mas nada sensível é embutido. Use import.meta.env.VITE_* no seu código.
    'process.env': '{}',
    'global': 'globalThis',
  },
});