// src/lib/openaiImageService.ts

// URL do seu backend — em produção, troque pelo domínio real
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'

export async function generateImageWithOpenAI(prompt: string): Promise<{
  base64: string
  mimeType: string
}> {
  const res = await fetch(`${BACKEND_URL}/api/generate-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error || `Erro ${res.status} ao gerar imagem`)
  }

  const data = await res.json()

  if (!data.imageBase64) {
    throw new Error('Backend não retornou imagem')
  }

  return {
    base64: data.imageBase64,
    mimeType: data.mimeType || 'image/png',
  }
}
