import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

// ─── Sessão isolada por aba ───────────────────────────────────────────────────
//
// PROBLEMA: O Supabase armazena o token de autenticação no `localStorage` sob
// uma chave fixa (ex: "sb-xxx-auth-token"). O `localStorage` é COMPARTILHADO
// entre todas as abas da mesma origem, então:
//   → Admin 1 loga na aba A  → token gravado em "sb-xxx-auth-token"
//   → Admin 2 loga na aba B  → sobrescreve o mesmo "sb-xxx-auth-token"
//   → Admin 1 é deslogado silenciosamente
//
// SOLUÇÃO: Usar um `storage` customizado que prefixa cada chave com um ID
// único de sessão guardado no `sessionStorage`. O `sessionStorage` é isolado
// por aba/janela, então cada aba tem seu próprio espaço de autenticação.
//
// Efeito prático:
//   Aba A → chaves: "sb-xxx-auth-token::tab_a1b2c3"
//   Aba B → chaves: "sb-xxx-auth-token::tab_d4e5f6"
//   Nenhuma aba interfere na outra.
//
// Recarregar a página na mesma aba continua logado (sessionStorage persiste
// enquanto a aba existir). Fechar e reabrir a aba começa uma nova sessão.

const SESSION_ID_KEY = 'mscolors_tab_session_id'

function getTabSessionId(): string {
  let id = sessionStorage.getItem(SESSION_ID_KEY)
  if (!id) {
    id = `tab_${Math.random().toString(36).slice(2, 10)}`
    sessionStorage.setItem(SESSION_ID_KEY, id)
  }
  return id
}

const tabSessionId = getTabSessionId()

// Storage customizado: lê/escreve no localStorage mas com chave prefixada
// pelo ID único desta aba, isolando a sessão de cada admin.
const tabIsolatedStorage = {
  getItem(key: string): string | null {
    return localStorage.getItem(`${key}::${tabSessionId}`)
  },
  setItem(key: string, value: string): void {
    localStorage.setItem(`${key}::${tabSessionId}`, value)
  },
  removeItem(key: string): void {
    localStorage.removeItem(`${key}::${tabSessionId}`)
  },
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Usa nosso storage isolado por aba — elimina o conflito entre admins
    storage: tabIsolatedStorage,
    // Mantém as demais configurações padrão do Supabase
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
})

// ─── Tipos do banco ───────────────────────────────────────────────────────────

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          role: 'client' | 'admin'
          access_code: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          email: string
          role?: 'client' | 'admin'
          access_code?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          role?: 'client' | 'admin'
          access_code?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      client_progress: {
        Row: {
          id: string
          user_id: string
          step: number
          completed: boolean
          data: Record<string, any> | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          step: number
          completed?: boolean
          data?: Record<string, any> | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          step?: number
          completed?: boolean
          data?: Record<string, any> | null
          created_at?: string
          updated_at?: string
        }
      }
      admin_content: {
        Row: {
          id: string
          type: 'contract' | 'form' | 'instructions'
          content: Record<string, any>
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          type: 'contract' | 'form' | 'instructions'
          content: Record<string, any>
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          type?: 'contract' | 'form' | 'instructions'
          content?: Record<string, any>
          created_at?: string
          updated_at?: string
        }
      }
      access_codes: {
        Row: {
          id: string
          code: string
          is_used: boolean
          user_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          code: string
          is_used?: boolean
          user_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          code?: string
          is_used?: boolean
          user_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
    }
  }
}