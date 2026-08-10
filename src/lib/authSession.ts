// src/lib/authSession.ts
//
// Evita chamadas concorrentes a supabase.auth.getSession() disparando
// refresh de token em paralelo.
//
// Vários lugares do app (driveStorage, chatStorage) chamam getSession()
// logo antes de cada fetch autenticado, pra pegar o access_token atual.
// Isso sempre funcionou porque essas chamadas eram raras/espaçadas. Mas
// agora, durante uma geração de imagem no GeminiChat, rolam VÁRIAS chamadas
// quase simultâneas (upload pro Drive + autosave do histórico do chat) —
// se duas caírem bem na hora do token expirar, cada uma tenta renovar o
// refresh token por conta própria. O Supabase só aceita usar um refresh
// token uma vez: a segunda chamada recebe "Invalid Refresh Token: Already
// Used" e isso derruba a sessão inteira (usuário é deslogado do nada).
//
// getAccessToken() resolve isso: se já existe uma renovação em andamento,
// quem chamar de novo espera o MESMO resultado em vez de disparar outra.

import { supabase } from './supabase'

let inFlight: Promise<string | undefined> | null = null

export async function getAccessToken(): Promise<string | undefined> {
  if (!inFlight) {
    inFlight = supabase.auth.getSession()
      .then(({ data }) => data.session?.access_token)
      .finally(() => { inFlight = null })
  }
  return inFlight
}
