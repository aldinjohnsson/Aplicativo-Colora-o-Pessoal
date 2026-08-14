// src/components/admin/DriveConnectionSection.tsx
import React, { useEffect, useState } from 'react'
import { CheckCircle, AlertCircle, Folder, Link2, Unlink, Loader2, Clock, Save } from 'lucide-react'
import { driveStorage, type DriveStatus } from '../../lib/driveStorage'
import { supabase } from '../../lib/supabase'

export function DriveConnectionSection() {
  const [status, setStatus]   = useState<DriveStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [rootInput, setRootInput] = useState({ id: '', name: '' })

  // ── Limpeza automática (dias configuráveis) ────────────────────────────
  //
  // Vive em admin_content type='settings', chaves fileRetentionEnabled e
  // fileRetentionDays — o MESMO row que SettingsEditor.tsx usa pro resto
  // das configurações. Por isso o save aqui é sempre um read-modify-write
  // (busca o content atual, funde só essas duas chaves, upsert de volta)
  // e NUNCA um upsert direto do objeto inteiro — se fizéssemos isso,
  // corrigiríamos por cima outras configs (emailDisplayName, adminEmail
  // etc.) que só existem na memória do SettingsEditor, não aqui.
  //
  // Sem row, ou sem essas chaves no JSON = limpeza LIGADA com 90 dias
  // (default alinhado com a política de retenção padrão do sistema).
  const [retentionEnabled, setRetentionEnabled] = useState(true)
  const [retentionDays, setRetentionDays]       = useState(90)
  const [daysInput, setDaysInput]                = useState('90')
  const [savingCleanup, setSavingCleanup]        = useState(false)
  const [daysDirty, setDaysDirty]                = useState(false)

  const reload = async () => {
    setLoading(true)
    try {
      const s = await driveStorage.getStatus()
      setStatus(s)
      setRootInput({ id: s.rootFolderId ?? '', name: s.rootFolderName ?? '' })

      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user?.id) {
        const { data: settingsRow } = await supabase
          .from('admin_content')
          .select('content')
          .eq('admin_id', session.user.id)
          .eq('type', 'settings')
          .maybeSingle()

        const cfg = (settingsRow?.content as any) ?? {}
        const enabled = cfg.fileRetentionEnabled !== false
        const days    = Number(cfg.fileRetentionDays) > 0 ? Number(cfg.fileRetentionDays) : 90
        setRetentionEnabled(enabled)
        setRetentionDays(days)
        setDaysInput(String(days))
        setDaysDirty(false)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Funde só fileRetentionEnabled/fileRetentionDays no content atual da
  // linha 'settings' — nunca sobrescreve o resto.
  const saveRetentionPrefs = async (patch: { fileRetentionEnabled?: boolean; fileRetentionDays?: number }) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user?.id) throw new Error('Sessão expirada. Faça login novamente.')

    const { data: current } = await supabase
      .from('admin_content')
      .select('content')
      .eq('admin_id', session.user.id)
      .eq('type', 'settings')
      .maybeSingle()

    const merged = { ...((current?.content as any) ?? {}), ...patch }

    const { error: upErr } = await supabase
      .from('admin_content')
      .upsert(
        { admin_id: session.user.id, type: 'settings', content: merged, updated_at: new Date().toISOString() },
        { onConflict: 'admin_id,type' }
      )
    if (upErr) throw new Error(upErr.message)
  }

  const handleToggleCleanup = async () => {
    const next = !retentionEnabled
    setSavingCleanup(true)
    setError(null)
    try {
      await saveRetentionPrefs({ fileRetentionEnabled: next })
      setRetentionEnabled(next)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSavingCleanup(false)
    }
  }

  const handleSaveDays = async () => {
    const parsed = Math.max(1, Math.min(365, parseInt(daysInput, 10) || 90))
    setSavingCleanup(true)
    setError(null)
    try {
      await saveRetentionPrefs({ fileRetentionDays: parsed })
      setRetentionDays(parsed)
      setDaysInput(String(parsed))
      setDaysDirty(false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSavingCleanup(false)
    }
  }

  useEffect(() => { reload() }, [])

  const handleConnect = async () => {
    setError(null); setBusy(true)
    try {
      const r = await driveStorage.connect()
      if (!r.ok) setError(r.error)
      else await reload()
    } catch (e: any) { setError(e.message) }
    finally { setBusy(false) }
  }

  const handleDisconnect = async () => {
    if (!confirm('Desconectar o Google Drive? Novos uploads vão falhar até reconectar.')) return
    setError(null); setBusy(true)
    try { await driveStorage.disconnect(); await reload() }
    catch (e: any) { setError(e.message) }
    finally { setBusy(false) }
  }

  const handleSaveRoot = async () => {
    setError(null); setBusy(true)
    try {
      const id   = rootInput.id.trim()   || null
      const name = rootInput.name.trim() || null
      await driveStorage.setRootFolder(id, name)
      await reload()
    } catch (e: any) { setError(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-3 sm:px-6 py-3 sm:py-4 border-b border-gray-100 bg-gradient-to-r from-green-50 to-emerald-50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 87.3 78" fill="currentColor">
              <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" opacity=".4"/>
              <path d="M43.65 25l-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" opacity=".7"/>
              <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z"/>
              <path d="M43.65 25l13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" opacity=".7"/>
              <path d="M59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z"/>
              <path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" opacity=".4"/>
            </svg>
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Google Drive</h2>
            <p className="text-sm text-gray-500">Armazenamento das fotos das clientes</p>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando status…
          </div>
        ) : status?.connected ? (
          <>
            <div className="flex flex-col sm:flex-row sm:items-start gap-3 rounded-xl p-4 bg-green-50 border border-green-200">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-green-900">Drive conectado</p>
                  <p className="text-xs text-green-700 truncate">como {status.googleEmail}</p>
                </div>
              </div>
              <button
                onClick={handleDisconnect}
                disabled={busy}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 shrink-0"
              >
                <Unlink className="h-3.5 w-3.5" /> Desconectar
              </button>
            </div>

            {/* ── Limpeza automática — prazo configurável ─────────────── */}
            <div className={`rounded-lg border px-3 py-3 ${retentionEnabled ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-start gap-2 text-xs text-gray-600 min-w-0">
                  <Clock className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${retentionEnabled ? 'text-amber-600' : 'text-gray-400'}`} />
                  <span>
                    Limpeza automática: pastas das clientes são excluídas do <strong>seu Drive</strong>{' '}
                    <strong>{retentionDays} dias após o resultado ser concluído</strong>. A cliente é avisada
                    por e-mail e no portal.
                    {!retentionEnabled && <span className="block mt-0.5 text-gray-500">Desativada — nenhuma pasta será apagada automaticamente.</span>}
                  </span>
                </div>
                {/* Toggle */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={retentionEnabled}
                  onClick={handleToggleCleanup}
                  disabled={savingCleanup}
                  title={retentionEnabled ? 'Desativar limpeza automática' : 'Ativar limpeza automática'}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${retentionEnabled ? 'bg-emerald-500' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${retentionEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>

              {retentionEnabled && (
                <div className="mt-3 pt-3 border-t border-amber-200">
                  {daysDirty && (
                    <p className="mb-2 text-xs font-medium text-amber-700 bg-amber-100 border border-amber-300 rounded-lg px-2.5 py-1.5">
                      ⚠️ Valor ainda não salvo — clique em "Salvar" aqui embaixo (o botão "Salvar" lá em cima, no
                      topo da página, NÃO salva este campo).
                    </p>
                  )}
                  <div className="flex items-end gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Excluir após (dias)</label>
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={daysInput}
                        onChange={e => { setDaysInput(e.target.value); setDaysDirty(true) }}
                        onBlur={() => { if (daysDirty) handleSaveDays() }}
                        className="w-24 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                      />
                    </div>
                    <button
                      onClick={handleSaveDays}
                      disabled={savingCleanup || !daysDirty}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40 whitespace-nowrap"
                    >
                      {savingCleanup ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      Salvar
                    </button>
                    {!daysDirty && (
                      <span className="text-xs text-gray-400 pb-1.5">Contado a partir de quando o resultado é liberado</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ── Pasta raiz ─────────────────────────────────────── */}
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Folder className="h-4 w-4 text-gray-500 shrink-0" />
                  <span className="text-sm font-medium text-gray-700">Pasta raiz no Drive</span>
                  <span className="text-xs text-gray-400 bg-gray-200 rounded-full px-2 py-0.5">opcional</span>
                </div>
                <a
                  href="https://drive.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-green-700 font-medium hover:underline"
                >
                  Abrir Google Drive
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>

              <div className="px-3 sm:px-4 py-4 space-y-4">
                {/* Passos */}
                <div className="space-y-2.5">
                  {[
                    { n: 1, text: 'Crie uma pasta no Google Drive onde as fotos das clientes serão salvas (ex: "Clientes Coloração")' },
                    { n: 2, text: 'Abra essa pasta no Drive, a URL vai ficar assim:' },
                    { n: 3, text: 'Copie o ID que aparece depois de /folders/ e cole no campo abaixo' },
                  ].map(step => (
                    <div key={step.n} className="flex gap-3 items-start">
                      <div className="w-5 h-5 rounded-full bg-green-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                        {step.n}
                      </div>
                      <p className="text-xs text-gray-600 leading-relaxed">{step.text}</p>
                    </div>
                  ))}
                </div>

                {/* Exemplo visual de URL */}
                <div className="bg-gray-900 rounded-lg px-3 py-2.5 font-mono text-xs leading-relaxed break-all select-all">
                  <span className="text-gray-400">drive.google.com/drive/folders/</span>
                  <span className="text-green-400 font-semibold">1aBcDeFgHiJkLmNoPqRsTuVwXyZ</span>
                </div>

                {/* Input + botão */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    placeholder="Cole o ID aqui (ex: 1aBcDeFgHiJkL…)"
                    value={rootInput.id}
                    onChange={e => setRootInput(s => ({ ...s, id: e.target.value }))}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
                  />
                  <button
                    onClick={handleSaveRoot}
                    disabled={busy}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 whitespace-nowrap"
                  >
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Salvar
                  </button>
                </div>

                {rootInput.id && (
                  <p className="text-xs text-green-700 font-medium">✓ ID preenchido — as subpastas das clientes serão criadas aqui.</p>
                )}
                {!rootInput.id && (
                  <p className="text-xs text-gray-400">Se deixar vazio, as subpastas ficam direto em "Meu Drive".</p>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start gap-3 rounded-xl p-4 bg-amber-50 border border-amber-200">
              <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-900">Drive não conectado</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Os uploads de fotos das clientes <strong>não vão funcionar</strong> até você conectar.
                </p>
              </div>
            </div>
            <button
              onClick={handleConnect}
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-br from-green-600 to-emerald-600 text-white text-sm font-medium rounded-xl hover:opacity-90 disabled:opacity-60 transition-opacity"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Conectar Google Drive
            </button>
          </>
        )}

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  )
}