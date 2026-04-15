export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' })

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

    const base64 = data?.data?.[0]?.b64_json

    if (base64) {
      console.log('✅ Imagem gerada (base64)! Tamanho:', base64.length)
      return res.json({ imageBase64: base64, mimeType: 'image/png' })
    }

    const imageUrl = data?.data?.[0]?.url
    if (imageUrl) {
      console.log('📥 Baixando imagem da URL...')
      const imgRes = await fetch(imageUrl)
      const buffer = await imgRes.arrayBuffer()
      const b64 = Buffer.from(buffer).toString('base64')
      console.log('✅ Imagem convertida! Tamanho:', b64.length)
      return res.json({ imageBase64: b64, mimeType: 'image/png' })
    }

    console.error('❌ Resposta sem imagem:', JSON.stringify(data, null, 2))
    return res.status(500).json({ error: 'OpenAI não retornou imagem' })

  } catch (error) {
    console.error('❌ Erro no servidor:', error)
    res.status(500).json({ error: 'Erro interno ao gerar imagem' })
  }
}