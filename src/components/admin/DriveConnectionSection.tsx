// src/components/admin/DriveConnectionSection.tsx
import React, { useEffect, useState } from 'react'
import { CheckCircle, AlertCircle, Folder, Link2, Unlink, Loader2, Clock } from 'lucide-react'
import { driveStorage, type DriveStatus } from '../../lib/driveStorage'

export function DriveConnectionSection() {
  const [status, setStatus]   = useState<DriveStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [rootInput, setRootInput] = useState({ id: '', name: '' })

  const reload = async () => {
    setLoading(true)
    try {
      const s = await driveStorage.getStatus()
      setStatus(s)
      setRootInput({ id: s.rootFolderId ?? '', name: s.rootFolderName ?? '' })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
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

      <div className="px-6 py-5 space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando status…
          </div>
        ) : status?.connected ? (
          <>
            <div className="flex items-start gap-3 rounded-xl p-4 bg-green-50 border border-green-200">
              <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-green-900">Drive conectado</p>
                <p className="text-xs text-green-700 truncate">como {status.googleEmail}</p>
              </div>
              <button
                onClick={handleDisconnect}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
              >
                <Unlink className="h-3.5 w-3.5" /> Desconectar
              </button>
            </div>

            <div className="flex items-start gap-2 text-xs text-gray-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
              <span>As pastas dos clientes são excluídas automaticamente <strong>21 dias após a análise ser entregue</strong>.</span>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                <Folder className="inline h-4 w-4 mr-1 -mt-0.5 text-gray-400" />
                Pasta raiz no Drive (opcional)
              </label>
              <p className="text-xs text-gray-500">
                Dentro dela vão ser criadas subpastas com o nome de cada cliente.
                Se deixar vazio, ficam direto na raiz do "Meu Drive".
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-2">
                <input
                  type="text"
                  placeholder="Nome (ex: Clientes 2026)"
                  value={rootInput.name}
                  onChange={e => setRootInput(s => ({ ...s, name: e.target.value }))}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
                />
                <input
                  type="text"
                  placeholder="ID da pasta (ex: 1aBcDeF...)"
                  value={rootInput.id}
                  onChange={e => setRootInput(s => ({ ...s, id: e.target.value }))}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
                />
              </div>
              <p className="text-xs text-gray-400">
                Pra pegar o ID: abra a pasta no Drive, copie da URL — o trecho depois de <code>/folders/</code>.
              </p>
              <button
                onClick={handleSaveRoot}
                disabled={busy}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Salvar pasta raiz
              </button>
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
