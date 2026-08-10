// src/lib/idbStorage.ts
//
// Adaptador de storage pra sessão do Supabase Auth usando IndexedDB em vez
// de localStorage.
//
// Por quê: em apps "Adicionados à Tela de Início" no iOS (modo standalone),
// o WebKit mata o processo do app quando ele fica em segundo plano pra
// liberar memória — bem mais agressivo do que faz com uma aba normal do
// Safari — e isso pode levar o localStorage junto, fazendo a sessão sumir
// a cada abertura do ícone (era o que estava acontecendo). IndexedDB é bem
// mais resistente a esse tipo de eviction na prática — é o storage
// recomendado pra esse cenário específico de PWA no iOS.
//
// Implementa a interface que o supabase-js aceita em `auth.storage`:
// getItem/setItem/removeItem, todos podendo retornar Promise.

const DB_NAME    = 'supabase-auth'
const STORE_NAME = 'kv'
const DB_VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const store = tx.objectStore(STORE_NAME)
    const req = fn(store)
    req.onsuccess   = () => resolve(req.result as T)
    req.onerror     = () => reject(req.error)
    tx.oncomplete   = () => db.close()
  })
}

// Fallback pra localStorage se IndexedDB não estiver disponível por algum
// motivo (ex: Safari em modo privado bloqueia IndexedDB por completo) —
// melhor ter uma sessão que não sobrevive tão bem do que travar o login.
const hasIndexedDB = typeof indexedDB !== 'undefined'

export const idbStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!hasIndexedDB) return localStorage.getItem(key)
    try {
      const value = await withStore<string | undefined>('readonly', store => store.get(key))
      if (value !== undefined) return value

      // Migração automática: na primeira leitura depois desse deploy, a
      // sessão de quem já estava logado ainda está no localStorage (formato
      // antigo). Copia pro IndexedDB uma vez, pra ninguém ser deslogado à
      // toa só por causa da troca de storage.
      const legacy = localStorage.getItem(key)
      if (legacy !== null) {
        await withStore('readwrite', store => store.put(legacy, key)).catch(() => {})
      }
      return legacy
    } catch {
      return localStorage.getItem(key)
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    if (!hasIndexedDB) { localStorage.setItem(key, value); return }
    try {
      await withStore('readwrite', store => store.put(value, key))
    } catch {
      localStorage.setItem(key, value)
    }
  },

  async removeItem(key: string): Promise<void> {
    if (!hasIndexedDB) { localStorage.removeItem(key); return }
    try {
      await withStore('readwrite', store => store.delete(key))
    } catch {
      localStorage.removeItem(key)
    }
  },
}
