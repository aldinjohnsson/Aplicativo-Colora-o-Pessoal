import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

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