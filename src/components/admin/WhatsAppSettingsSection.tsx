// src/components/admin/WhatsAppSettingsSection.tsx
//
// Seção de configuração do WhatsApp (Cloud API oficial). SOMENTE super_admin.
// Renderize assim no SettingsEditor, perto da "Configuração Global de E-mail":
//
//     {isSuperAdmin && <WhatsAppSettingsSection />}
//
// Guarda tudo numa linha admin_content (type='whatsapp_settings') do super_admin
// — mesmo padrão do global_email_settings. A edge function 'send-whatsapp'
// lê essa linha por baixo do RLS (service role) na hora de disparar.

import React, { useEffect, useState } from 'react'
import { MessageCircle, Loader2, Send, CheckCircle, AlertCircle, Save } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { adminService } from '../../lib/services'
import { sendWhatsAppTest } from '../../lib/whatsappService'

interface Plan { id: string; name: string; is_active?: boolean }

interface WhatsAppSettings {
  enabled: boolean
  phoneNumberId: string
  accessToken: string
  templateName: string
  templateLang: string
  defaultMessage: string
  planMessages: Record<string, string>
}

const DEFAULTS: WhatsAppSettings = {
  enabled: false,
  phoneNumberId: '',
  accessToken: '',
  templateName: 'analise_concluida',
  templateLang: 'pt_BR',
  defaultMessage:
    'Sua análise de coloração pessoal foi concluída! 🎨 Acesse o portal para ver o resultado completo.',
  planMessages: {},
}

export function WhatsAppSettingsSection() {
  const [cfg, setCfg] = useState<WhatsAppSettings>(DEFAULTS)
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [testPhone, setTestPhone] = useState('')
  // (testPlan removido — mensagem agora é sempre a mesma, sem variação por plano)
  const [testing, setTesting] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const [{ data: row }, planList] = await Promise.all([
        supabase.from('admin_content').select('content')
          .eq('admin_id', user?.id ?? '').eq('type', 'whatsapp_settings').maybeSingle(),
        adminService.getPlans().catch(() => [] as Plan[]),
      ])
      setPlans((planList as Plan[]).filter(p => p.is_active !== false))
      if (row?.content) setCfg({ ...DEFAULTS, ...(row.content as WhatsAppSettings) })
    } catch {
      setMsg({ type: 'error', text: 'Erro ao carregar configurações de WhatsApp' })
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setSaving(true); setMsg(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Sessão expirada. Faça login novamente.')
      const { error } = await supabase.from('admin_content').upsert(
        { admin_id: user.id, type: 'whatsapp_settings', content: cfg, updated_at: new Date().toISOString() },
        { onConflict: 'admin_id,type' },
      )
      if (error) throw new Error(error.message)
      setMsg({ type: 'success', text: 'Configurações de WhatsApp salvas!' })
      setTimeout(() => setMsg(null), 5000)
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.message || 'Erro ao salvar' })
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    if (!testPhone.trim()) { setMsg({ type: 'error', text: 'Informe um número para o teste' }); return }
    setTesting(true); setMsg(null)
    try {
      // salva antes pra garantir que o teste usa a config atual
      await handleSave()
      await sendWhatsAppTest(testPhone, null)
      setMsg({ type: 'success', text: 'Teste enviado! Confira o WhatsApp do número informado.' })
    } catch (e: any) {
      setMsg({ type: 'error', text: 'Falha no teste: ' + (e?.message || 'erro desconhecido') })
    } finally {
      setTesting(false)
    }
  }

  const set = (patch: Partial<WhatsAppSettings>) => setCfg(c => ({ ...c, ...patch }))
  const setPlanMsg = (planId: string, text: string) =>
    setCfg(c => ({ ...c, planMessages: { ...c.planMessages, [planId]: text } }))

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 flex items-center gap-3 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando configurações de WhatsApp…
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-3 sm:px-6 py-3 sm:py-4 border-b border-gray-100 bg-gradient-to-r from-green-50 to-emerald-50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-green-500 to-emerald-500 rounded-xl flex items-center justify-center">
            <MessageCircle className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Notificação por WhatsApp</h2>
            <p className="text-sm text-gray-500">Dispara mensagem pra cliente quando a análise é concluída</p>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-5">
        {/* Liga/desliga */}
        <label className="flex items-center justify-between gap-4 cursor-pointer">
          <span className="text-sm font-medium text-gray-700">
            Ativar disparo automático ao concluir
          </span>
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={e => set({ enabled: e.target.checked })}
            className="h-5 w-5 accent-green-600"
          />
        </label>

        <div className="bg-green-50 border border-green-100 rounded-xl p-3">
          <p className="text-xs text-green-700 leading-relaxed">
            ℹ️ Mensagem iniciada pela empresa usa <strong>template aprovado</strong> na Meta (analise_concluida_v2).
            O template precisa ter 2 variáveis no corpo: <span className="font-mono">{'{{1}}'} {'{{2}}'}</span>
            {' '}— <strong>{'{{1}}'}</strong> é o nome da cliente e <strong>{'{{2}}'}</strong> é o link do portal —
            cada cliente recebe o dela automaticamente. O resto do texto (aviso de resultado liberado,
            agradecimento, assinatura, rodapé de suporte) já vem fixo de dentro do próprio template aprovado —
            é a mesma mensagem pra qualquer plano.
          </p>
        </div>

        {/* Credenciais */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number ID</label>
            <input
              value={cfg.phoneNumberId}
              onChange={e => set({ phoneNumberId: e.target.value.trim() })}
              placeholder="123456789012345"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1.5">Meta → WhatsApp → API Setup.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Access Token (permanente)</label>
            <input
              type="password"
              value={cfg.accessToken}
              onChange={e => set({ accessToken: e.target.value.trim() })}
              placeholder="EAAG..."
              autoComplete="off"
              spellCheck={false}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1.5">Token de System User (não expira).</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome do template</label>
            <input
              value={cfg.templateName}
              onChange={e => set({ templateName: e.target.value.trim() })}
              placeholder="analise_concluida_v2"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Idioma do template</label>
            <input
              value={cfg.templateLang}
              onChange={e => set({ templateLang: e.target.value.trim() })}
              placeholder="pt_BR"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
            />
          </div>
        </div>

        {/* Mensagem agora é fixa (dentro do template aprovado na Meta) — não
            tem mais campo de "frase por plano" pra editar aqui: é a mesma
            mensagem pra qualquer plano, só o nome e o link mudam por cliente. */}

        {/* Teste */}
        <div className="border-t border-gray-100 pt-4">
          <p className="text-sm font-medium text-gray-700 mb-2">Enviar teste</p>
          <div className="flex flex-col gap-2">
            <input
              value={testPhone}
              onChange={e => setTestPhone(e.target.value)}
              placeholder="DDD + número (ex: 41999998888)"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
            />
            <button
              onClick={handleTest}
              disabled={testing}
              className="w-full sm:w-auto self-start px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Testar
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1.5">Salva a config e dispara um envio real pro número informado.</p>
        </div>

        {/* Status + salvar */}
        {msg && (
          <div
            className={`flex items-start gap-2 rounded-lg p-3 text-sm ${
              msg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}
          >
            {msg.type === 'success' ? <CheckCircle className="h-4 w-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />}
            <span className="break-words">{msg.text}</span>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full sm:w-auto px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-gray-900 hover:bg-gray-800 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar configurações
        </button>
      </div>
    </div>
  )
}