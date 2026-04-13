import dotenv from 'dotenv'
import express from 'express'
import fetch from 'node-fetch'
import cors from 'cors'

dotenv.config()

const app = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))

// ─── Health check ───────────────────────────────────────────
app.get('/health', (_, res) => res.json({ ok: true }))

// ─── Geração de imagem via OpenAI ───────────────────────────
app.post('/api/generate-image', async (req, res) => {
  try {
    const { prompt } = req.body

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt é obrigatório' })
    }

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY não configurada no servidor' })
    }

    console.log('🎨 Gerando imagem com prompt:', prompt.substring(0, 100) + '...')

    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: `Realistic photo based on this beauty/style request: ${prompt}. Keep natural face proportions, skin tone and realistic lighting.`,
        n: 1,
        size: '1024x1024',
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('❌ OpenAI error:', JSON.stringify(data, null, 2))
      return res.status(response.status).json({
        error: data?.error?.message || 'Erro na OpenAI',
      })
    }

    console.log('📦 Response keys:', Object.keys(data?.data?.[0] || {}))

    // gpt-image-1 retorna b64_json por padrão
    const base64 = data?.data?.[0]?.b64_json

    if (base64) {
      console.log('✅ Imagem gerada (base64)! Tamanho:', base64.length)
      return res.json({ imageBase64: base64, mimeType: 'image/png' })
    }

    // Fallback: se retornou URL, baixar e converter
    const imageUrl = data?.data?.[0]?.url
    if (imageUrl) {
      console.log('📥 Baixando imagem da URL...')
      const imgRes = await fetch(imageUrl)
      const buffer = await imgRes.buffer()
      const b64 = buffer.toString('base64')
      console.log('✅ Imagem convertida! Tamanho:', b64.length)
      return res.json({ imageBase64: b64, mimeType: 'image/png' })
    }

    console.error('❌ Resposta sem imagem:', JSON.stringify(data, null, 2))
    return res.status(500).json({ error: 'OpenAI não retornou imagem' })

  } catch (error) {
    console.error('❌ Erro no servidor:', error)
    res.status(500).json({ error: 'Erro interno ao gerar imagem' })
  }
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`🚀 Backend rodando em http://localhost:${PORT}`)
})