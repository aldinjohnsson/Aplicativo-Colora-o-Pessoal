// src/components/admin/documents/DocumentsHub.tsx
//
// Entrypoint da feature "Gerador de Documento".
// Usa rotas aninhadas para separar o hub (com sub-abas) do editor.
//
//   /admin/documents                     → hub com tabs [Tags | Templates]
//   /admin/documents/templates/:id       → editor de um template específico
//
// O AdminDashboard registra /documents/* apontando para este componente.

import React from 'react'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { FileText, Tag as TagIcon, Layers } from 'lucide-react'
import { TagsManager } from './tags/TagsManager'
import { TemplatesList } from './templates/TemplatesList'
import { TemplateEditor } from './templates/editor/TemplateEditor'

type Tab = 'tags' | 'templates'

// ─── Shell (header + tabs) ───────────────────────────────────────────

function DocumentsHubShell({ tab }: { tab: Tab }) {
  const navigate = useNavigate()

  const TABS: { id: Tab; label: string; icon: any; to: string }[] = [
    { id: 'tags',      label: 'Tags',      icon: TagIcon, to: '/admin/documents/tags' },
    { id: 'templates', label: 'Templates', icon: Layers,  to: '/admin/documents/templates' },
  ]

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Topbar */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex-shrink-0">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-100 to-pink-100 flex items-center justify-center">
            <FileText className="h-5 w-5 text-rose-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Gerador de Documento</h1>
            <p className="text-xs text-gray-500">
              Crie tags reutilizáveis e monte templates de PDF para gerar documentos personalizados por cliente.
            </p>
          </div>
        </div>
      </div>

      {/* Body scrollable */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto w-full p-4 sm:p-6 space-y-5">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
            {TABS.map(({ id, label, icon: Icon, to }) => (
              <button
                key={id}
                onClick={() => navigate(to)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          {tab === 'tags' && <TagsManager />}
          {tab === 'templates' && <TemplatesList />}
        </div>
      </div>
    </div>
  )
}

// ─── Router ───────────────────────────────────────────────────────────

export function DocumentsHub() {
  const location = useLocation()

  // Detecta a aba só pra colorir o destaque.
  const path = location.pathname
  const tab: Tab =
    path.includes('/documents/templates') ? 'templates' : 'tags'

  return (
    <Routes>
      {/* Editor de um template específico — tela cheia, sem o shell */}
      <Route path="templates/:templateId" element={<TemplateEditor />} />

      {/* Rotas que usam o shell com abas */}
      <Route path="tags"      element={<DocumentsHubShell tab="tags" />} />
      <Route path="templates" element={<DocumentsHubShell tab="templates" />} />

      {/* Default: redireciona para Tags */}
      <Route path="*" element={<DocumentsHubShell tab={tab} />} />
    </Routes>
  )
}
