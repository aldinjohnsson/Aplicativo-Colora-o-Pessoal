import { supabase } from './supabase'

// Mock user for development
const MOCK_USER = {
  id: '550e8400-e29b-41d4-a716-446655440000', // Valid UUID format
  email: 'cliente@exemplo.com',
  role: 'client' as const
}

export class AuthService {
  private static instance: AuthService
  private currentUser: typeof MOCK_USER | null = null

  private constructor() {
    // Initialize with mock user for development
    this.currentUser = MOCK_USER
    this.ensureUserExists()
  }

  static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService()
    }
    return AuthService.instance
  }

  private async ensureUserExists() {
    if (!this.currentUser) return

    try {
      // Check if user exists in database
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('id', this.currentUser.id)
        .maybeSingle()

      if (!existingUser) {
        // Create user in database
        const { error } = await supabase
          .from('users')
          .insert({
            id: this.currentUser.id,
            email: this.currentUser.email,
            role: this.currentUser.role
          })

        if (error) {
          console.error('Error creating mock user:', error)
        }
      }
    } catch (error) {
      console.error('Error ensuring user exists:', error)
    }
  }

  getCurrentUser() {
    return this.currentUser
  }

  async signIn(email: string, password: string) {
    // Mock sign in - in production this would use Supabase Auth
    this.currentUser = MOCK_USER
    await this.ensureUserExists()
    return this.currentUser
  }

  async signOut() {
    this.currentUser = null
  }

  isAuthenticated(): boolean {
    return this.currentUser !== null
  }
}

export const authService = AuthService.getInstance()