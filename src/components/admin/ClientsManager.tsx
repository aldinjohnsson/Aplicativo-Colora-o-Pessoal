// src/components/admin/ClientsManager.tsx
// KanbanBoard integrado com dados reais do Supabase

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Routes, Route, useNavigate, useParams } from 'react-router-dom'
import {
  Plus, Search, Eye, Trash2, ArrowLeft, Copy, CheckCircle,
  Clock, FileText, Camera, Upload, X, ExternalLink,
  Check, Download, User, Phone, Mail,
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2,
  FolderOpen, Image, ClipboardList,
  LayoutGrid, List, Calendar,
  AlertTriangle, Save, MessageSquare, Link2, Tag,
  Lock, Unlock,
  MoreHorizontal, Archive, ArchiveRestore, Star, Layers,
  SlidersHorizontal, ChevronDown, Palette,
} from 'lucide-react'
import { adminService, Client, Plan } from '../../lib/services'
import { supabase } from '../../lib/supabase'
import { formatDeadlineDate, calendarDaysUntil, parseLocalDate } from '../../lib/deadlineCalculator'
import { AIPromptConfig } from './AIPromptConfig'
import { RejectionModal } from './RejectionModal'
import { StageController } from './StageController'
import { THEMES, ThemeName, Theme, useTheme } from '../../lib/theme'
import { ClientDocumentsTab } from './documents/client/ClientDocumentsTab'

// ─── Status Config ────────────────────────────────────────────────────────
const STATUSES: Record<string, {
  label: string; short: string; color: string; bg: string; textColor: string
  tailwindColor: string; tailwindBg: string
}> = {
  awaiting_contract: {
    label: 'Aguardando Contrato', short: 'Contrato',
    color: '#f59e0b', bg: '#fef3c7', textColor: '#92400e',
    tailwindColor: 'bg-amber-100 text-amber-700', tailwindBg: 'bg-amber-50',
  },
  awaiting_form: {
    label: 'Aguardando Formulário', short: 'Formulário',
    color: '#3b82f6', bg: '#dbeafe', textColor: '#1e40af',
    tailwindColor: 'bg-blue-100 text-blue-700', tailwindBg: 'bg-blue-50',
  },
  awaiting_photos: {
    label: 'Aguardando Fotos', short: 'Fotos',
    color: '#a855f7', bg: '#f3e8ff', textColor: '#6b21a8',
    tailwindColor: 'bg-purple-100 text-purple-700', tailwindBg: 'bg-purple-50',
  },
  // fotos recebidas, aguardando aprovação da admin (fotos + formulário)
  photos_submitted: {
    label: 'Fotos Enviadas', short: 'Fotos Enviadas',
    color: '#ec4899', bg: '#fce7f3', textColor: '#9d174d',
    tailwindColor: 'bg-pink-100 text-pink-700', tailwindBg: 'bg-pink-50',
  },
  in_analysis: {
    label: 'Análise em Andamento', short: 'Análise',
    color: '#f97316', bg: '#ffedd5', textColor: '#9a3412',
    tailwindColor: 'bg-orange-100 text-orange-700', tailwindBg: 'bg-orange-50',
  },
  completed: {
    label: 'Concluído', short: 'Concluído',
    color: '#22c55e', bg: '#dcfce7', textColor: '#166534',
    tailwindColor: 'bg-green-100 text-green-700', tailwindBg: 'bg-green-50',
  },
}
// photos_submitted is between awaiting_photos and in_analysis
const COL_ORDER = ['awaiting_contract', 'awaiting_form', 'awaiting_photos', 'photos_submitted', 'in_analysis', 'completed']

// ─── Avatar Helpers ───────────────────────────────────────────────────────
const AVATAR_COLORS: [string, string][] = [
  ['#fce7f3', '#be185d'], ['#ede9fe', '#6d28d9'], ['#dbeafe', '#1d4ed8'],
  ['#dcfce7', '#15803d'], ['#fef3c7', '#b45309'], ['#ffedd5', '#c2410c'],
]
function getAvatarColor(name: string): [string, string] {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]
}
function getInitials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

// ─── Deadline Info ────────────────────────────────────────────────────────
interface DeadlineData {
  deadline_date: string
  photos_sent_at: string
}
interface DeadlineInfo {
  label: string
  urgency: 'danger' | 'warning' | 'ok'
  color: string
}
function getDeadlineInfo(client: Client, deadline?: DeadlineData | null): DeadlineInfo | null {
  if (!deadline?.deadline_date || client.status === 'completed' || client.status === 'photos_submitted') return null
 
  const today = new Date(); today.setHours(0, 0, 0, 0)
  // CORRIGIDO: parseLocalDate evita bug de timezone (new Date("YYYY-MM-DD") = UTC = dia errado no Brasil)
  const dl = parseLocalDate(deadline.deadline_date)
  const days = Math.round((dl.getTime() - today.getTime()) / 86400000)
 
  if (days < 0) return { label: `${Math.abs(days)}d atrasado`, urgency: 'danger', color: '#ef4444' }
  if (days === 0) return { label: 'Vence hoje', urgency: 'danger', color: '#ef4444' }
  if (days <= 2) return { label: `${days}d restante`, urgency: 'warning', color: '#f59e0b' }
  return { label: `${days}d restante`, urgency: 'ok', color: '#6b7280' }
}

// ─── Tiny UI ──────────────────────────────────────────────────────────────
const Btn = ({ children, onClick, variant = 'primary', size = 'md', loading = false, disabled = false, className = '' }: any) => {
  const v: any = {
    primary: 'bg-rose-500 text-white hover:bg-rose-600',
    outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
    ghost: 'text-gray-600 hover:bg-gray-100',
    green: 'bg-green-500 text-white hover:bg-green-600',
    danger: 'bg-red-50 text-red-600 hover:bg-red-100',
    pink: 'bg-pink-500 text-white hover:bg-pink-600',
  }
  const s: any = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm' }
  return (
    <button onClick={onClick} disabled={disabled || loading}
      className={`inline-flex items-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${v[variant]} ${s[size]} ${className}`}>
      {loading && <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />}
      {children}
    </button>
  )
}

// ─── Kanban Card ──────────────────────────────────────────────────────────
function KanbanCard({
  client, deadline, theme: t, onView, onArchive, onDelete, onStar, compact, starred,
}: {
  client: Client; deadline?: DeadlineData | null; theme: Theme
  onView: () => void; onArchive: () => void; onDelete: () => void; onStar: () => void
  compact: boolean; starred: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const dl = getDeadlineInfo(client, deadline)
  const [bgColor, fgColor] = getAvatarColor(client.full_name)
  const needsReview = client.status === 'photos_submitted'

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div
      style={{
        background: t.cardBg,
        border: `1px solid ${dl?.urgency === 'danger' ? '#fca5a5' : dl?.urgency === 'warning' ? '#fcd34d' : needsReview ? '#fbcfe8' : t.cardBorder}`,
        borderRadius: 10, padding: compact ? '9px 12px' : '12px 14px',
        marginBottom: 8, cursor: 'pointer', position: 'relative',
        transition: 'box-shadow 0.15s', boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 2px rgba(0,0,0,0.06)' }}
      onClick={onView}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{
          width: compact ? 28 : 34, height: compact ? 28 : 34, borderRadius: '50%',
          background: bgColor, color: fgColor, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: compact ? 11 : 13, fontWeight: 700, flexShrink: 0,
        }}>
          {getInitials(client.full_name)}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <p style={{
              margin: 0, fontSize: compact ? 12 : 13, fontWeight: 600, color: t.text,
              lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {client.full_name}
            </p>
            {starred && <span style={{ fontSize: 10, color: '#f59e0b', flexShrink: 0 }}>★</span>}
          </div>
          {!compact && client.plan && (
            <p style={{ margin: '2px 0 0', fontSize: 11, color: t.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {(client as any).plan.name}
            </p>
          )}
        </div>

        <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <button onClick={() => setMenuOpen(v => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: t.text3, borderRadius: 4, display: 'flex', alignItems: 'center', opacity: 0.5 }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; (e.currentTarget as HTMLButtonElement).style.background = t.surface2 }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.5'; (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div style={{
              position: 'absolute', right: 0, top: 22, background: t.surface,
              border: `1px solid ${t.border}`, borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 100, minWidth: 160, overflow: 'hidden',
            }}>
              {[
                { icon: Eye, label: 'Abrir cliente', action: onView, color: t.text },
                { icon: Star, label: starred ? 'Remover estrela' : 'Destacar', action: onStar, color: '#f59e0b' },
                { icon: Archive, label: 'Arquivar', action: onArchive, color: '#6b7280' },
                { icon: Trash2, label: 'Excluir', action: onDelete, color: '#ef4444' },
              ].map(({ icon: Icon, label, action, color }) => (
                <button key={label} onClick={() => { action(); setMenuOpen(false) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color, textAlign: 'left' }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = t.surface2}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'none'}
                >
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!compact && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
            <Mail size={11} color={t.text3} />
            <span style={{ fontSize: 11, color: t.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{client.email}</span>
          </div>
          {client.phone && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Phone size={11} color={t.text3} />
              <span style={{ fontSize: 11, color: t.text2 }}>{client.phone}</span>
            </div>
          )}
          {needsReview && (
            <div style={{ marginTop: 6 }}>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 700, background: '#fce7f3', color: '#9d174d' }}>
                📸 Aguardando aprovação
              </span>
            </div>
          )}
          {dl && (
            <div style={{ marginTop: 6 }}>
              <span style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 600,
                background: dl.urgency === 'danger' ? '#fee2e2' : dl.urgency === 'warning' ? '#fef3c7' : t.surface2,
                color: dl.urgency === 'danger' ? '#991b1b' : dl.urgency === 'warning' ? '#92400e' : t.text3,
              }}>
                📅 {dl.label}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Kanban Column ────────────────────────────────────────────────────────
function KanbanColumn({
  statusKey, clients, deadlines, starredIds, theme: t,
  onView, onArchive, onDelete, onStar, collapsed, onToggleCollapse,
}: {
  statusKey: string; clients: Client[]; deadlines: Record<string, DeadlineData>
  starredIds: Set<string>; theme: Theme
  onView: (id: string) => void; onArchive: (id: string) => void
  onDelete: (id: string) => void; onStar: (id: string) => void
  collapsed: boolean; onToggleCollapse: () => void
}) {
  const cfg = STATUSES[statusKey]
  const dangerCount = clients.filter(c => getDeadlineInfo(c, deadlines[c.id])?.urgency === 'danger').length
  const reviewCount = statusKey === 'photos_submitted' ? clients.length : 0
  const [compact, setCompact] = useState(false)

  if (collapsed) {
    return (
      <div onClick={onToggleCollapse} title={`Expandir: ${cfg.label}`}
        style={{
          flexShrink: 0, width: 44, background: t.colBg, borderRadius: 12,
          border: `1px solid ${t.border}`, cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: '14px 0', gap: 10,
        }}
      >
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: cfg.color }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: t.text2, writingMode: 'vertical-rl', textOrientation: 'mixed', letterSpacing: 1, transform: 'rotate(180deg)', userSelect: 'none' }}>
          {cfg.short}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: t.accent, background: t.accentLight, borderRadius: 20, padding: '2px 6px', minWidth: 22, textAlign: 'center' }}>
          {clients.length}
        </span>
        {dangerCount > 0 && <span style={{ fontSize: 10, color: '#ef4444' }}>⚠{dangerCount}</span>}
        {reviewCount > 0 && <span style={{ fontSize: 10, color: '#ec4899' }}>📸{reviewCount}</span>}
        <ChevronRight size={13} color={t.text3} />
      </div>
    )
  }

  return (
    <div style={{
      flexShrink: 0, width: 'clamp(240px, 80vw, 380px)', background: t.colBg, borderRadius: 12,
      border: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column',
      maxHeight: '100%', overflow: 'hidden',
    }}>
      <div style={{ padding: '10px 12px 8px', borderBottom: `1px solid ${t.border}`, background: t.colBg, position: 'sticky', top: 0, zIndex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: t.text, letterSpacing: 0.2 }}>{cfg.short}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: t.accent, background: t.accentLight, borderRadius: 20, padding: '1px 7px', minWidth: 22, textAlign: 'center' }}>
            {clients.length}
          </span>
          {dangerCount > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', background: '#fee2e2', borderRadius: 20, padding: '1px 6px' }}>⚠{dangerCount}</span>
          )}
          {reviewCount > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, color: '#9d174d', background: '#fce7f3', borderRadius: 20, padding: '1px 6px' }}>📸 revisar</span>
          )}
          <button onClick={() => setCompact(v => !v)} title={compact ? 'Modo normal' : 'Modo compacto'}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: t.text3, opacity: 0.7, borderRadius: 4, display: 'flex' }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.opacity = '1'}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.opacity = '0.7'}
          ><Layers size={13} /></button>
          <button onClick={onToggleCollapse} title="Recolher coluna"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: t.text3, opacity: 0.7, borderRadius: 4, display: 'flex' }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.opacity = '1'}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.opacity = '0.7'}
          ><ChevronLeft size={14} /></button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px', paddingBottom: 6 }}>
        {clients.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 12px', color: t.text3 }}>
            <p style={{ fontSize: 12, margin: 0 }}>Nenhuma cliente</p>
          </div>
        ) : (
          clients.map(client => (
            <KanbanCard
              key={client.id} client={client} deadline={deadlines[client.id] || null}
              theme={t} compact={compact} starred={starredIds.has(client.id)}
              onView={() => onView(client.id)} onArchive={() => onArchive(client.id)}
              onDelete={() => onDelete(client.id)} onStar={() => onStar(client.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ─── Kanban Sidebar ───────────────────────────────────────────────────────
function KanbanSidebar({
  theme: t, clients, search, onSearch, filter, onFilter,
  sidebarOpen, onToggle, total, archivedCount, deadlines,
}: {
  theme: Theme; clients: Client[]; search: string; onSearch: (v: string) => void
  filter: string; onFilter: (v: string) => void; sidebarOpen: boolean; onToggle: () => void
  total: number; archivedCount: number; deadlines: Record<string, DeadlineData>
}) {
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    COL_ORDER.forEach(k => { c[k] = clients.filter(cl => cl.status === k).length })
    return c
  }, [clients])

  const dangerCount = useMemo(() =>
    clients.filter(c => getDeadlineInfo(c, deadlines[c.id])?.urgency === 'danger').length,
    [clients, deadlines]
  )

  const navBtn = (key: string, label: string, count: number, color?: string, icon?: React.ReactNode) => (
    <button key={key} onClick={() => onFilter(key)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px',
        borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, textAlign: 'left',
        background: filter === key ? t.accentLight : 'none',
        color: filter === key ? t.accent : (color || t.text2),
        fontWeight: filter === key ? 600 : 400,
      }}
      onMouseEnter={e => { if (filter !== key) (e.currentTarget as HTMLButtonElement).style.background = t.surface2 }}
      onMouseLeave={e => { if (filter !== key) (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
    >
      {icon && <span style={{ flexShrink: 0 }}>{icon}</span>}
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: filter === key ? t.accent : t.text3 }}>{count}</span>
    </button>
  )

  return (
    <>
      {sidebarOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 29, background: 'rgba(0,0,0,0.4)' }}
          className="sm:hidden" onClick={onToggle} />
      )}
      <div style={{
        width: sidebarOpen ? 220 : 0, flexShrink: 0, background: t.sidebar,
        borderRight: sidebarOpen ? `1px solid ${t.border}` : 'none', overflow: 'hidden',
        transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
        display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 30,
      }}>
        <div style={{ width: 220, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 12px 8px' }}>
            <div style={{ position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: t.text3 }} />
              <input value={search} onChange={e => onSearch(e.target.value)} placeholder="Buscar cliente..."
                style={{ width: '100%', padding: '7px 10px 7px 30px', borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface2, fontSize: 12, color: t.text, outline: 'none', boxSizing: 'border-box' as const }} />
            </div>
          </div>

          <div style={{ padding: '4px 8px', flex: 1, overflowY: 'auto' }}>
            {navBtn('all', 'Todas as clientes', total)}
            {navBtn('danger', 'Prazo crítico', dangerCount, '#ef4444', <AlertTriangle size={14} />)}
            {navBtn('photos_submitted', 'Aguardando revisão', counts['photos_submitted'] || 0, '#9d174d', <Camera size={14} />)}

            <div style={{ borderTop: `1px solid ${t.border}`, margin: '8px 0', padding: '8px 0 4px' }}>
              <p style={{ margin: '0 0 4px 10px', fontSize: 10, fontWeight: 700, color: t.text3, textTransform: 'uppercase' as const, letterSpacing: 1 }}>Por status</p>
              {COL_ORDER.map(key => {
                const cfg = STATUSES[key]
                return (
                  <button key={key} onClick={() => onFilter(key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '7px 10px',
                      borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, textAlign: 'left',
                      background: filter === key ? t.accentLight : 'none',
                      color: filter === key ? t.accent : t.text2,
                      fontWeight: filter === key ? 600 : 400,
                    }}
                    onMouseEnter={e => { if (filter !== key) (e.currentTarget as HTMLButtonElement).style.background = t.surface2 }}
                    onMouseLeave={e => { if (filter !== key) (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
                  >
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>{cfg.short}</span>
                    <span style={{ fontSize: 11, color: t.text3 }}>{counts[key]}</span>
                  </button>
                )
              })}
            </div>

            <div style={{ borderTop: `1px solid ${t.border}`, margin: '4px 0', paddingTop: 8 }}>
              <button onClick={() => onFilter('archived')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px',
                  borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, textAlign: 'left',
                  background: filter === 'archived' ? t.accentLight : 'none',
                  color: filter === 'archived' ? t.accent : t.text2,
                  fontWeight: filter === 'archived' ? 600 : 400,
                }}
                onMouseEnter={e => { if (filter !== 'archived') (e.currentTarget as HTMLButtonElement).style.background = t.surface2 }}
                onMouseLeave={e => { if (filter !== 'archived') (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
              >
                <Archive size={15} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1 }}>Arquivadas</span>
                <span style={{ fontSize: 11, color: t.text3 }}>{archivedCount}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Archive View ─────────────────────────────────────────────────────────
function ArchiveView({ clients, theme: t, onRestore, onDelete }: {
  clients: Client[]; theme: Theme; onRestore: (id: string) => void; onDelete: (id: string) => void
}) {
  if (clients.length === 0) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, color: t.text3 }}>
      <Archive size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
      <p style={{ fontSize: 14, margin: 0 }}>Nenhuma cliente arquivada</p>
    </div>
  )

  return (
    <div style={{ padding: 20 }}>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Archive size={18} color={t.text2} />
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.text }}>Clientes Arquivadas</h2>
        <span style={{ fontSize: 12, color: t.text3, background: t.surface2, padding: '2px 8px', borderRadius: 20 }}>{clients.length}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px,1fr))', gap: 12 }}>
        {clients.map(client => {
          const [bg, fg] = getAvatarColor(client.full_name)
          const cfg = STATUSES[client.status]
          return (
            <div key={client.id} style={{ background: t.cardBg, border: `1px solid ${t.border}`, borderRadius: 12, padding: '14px 16px', opacity: 0.8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: bg, color: fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>
                  {getInitials(client.full_name)}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: t.text }}>{client.full_name}</p>
                  <p style={{ margin: 0, fontSize: 11, color: t.text2 }}>{(client as any).plan?.name}</p>
                </div>
                <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, background: cfg?.bg, color: cfg?.textColor, fontWeight: 600 }}>{cfg?.short}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => onRestore(client.id)}
                  style={{ flex: 1, padding: 6, borderRadius: 8, border: `1px solid ${t.border}`, background: 'none', cursor: 'pointer', fontSize: 12, color: t.text2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = t.surface2}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'none'}
                ><ArchiveRestore size={13} /> Restaurar</button>
                <button onClick={() => onDelete(client.id)}
                  style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #fca5a5', background: 'none', cursor: 'pointer', fontSize: 12, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 6 }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#fee2e2'}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'none'}
                ><Trash2 size={13} /></button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Clients List ─────────────────────────────────────────────────────────
function ClientsList({ onOpenNav }: { onOpenNav?: () => void }) {
  const [clients, setClients] = useState<Client[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [deadlines, setDeadlines] = useState<Record<string, DeadlineData>>({})
  const [loading, setLoading] = useState(window.innerWidth >= 768)
  const { theme: t, themeName, setThemeName } = useTheme()
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 768)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set())
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board')
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', birth_date: '', plan_id: '', notes: '' })
  const [themeOpen, setThemeOpen] = useState(false)
  const themeRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => { load() }, [])
  useEffect(() => {
    const h = (e: MouseEvent) => { if (themeRef.current && !themeRef.current.contains(e.target as Node)) setThemeOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const load = async () => {
    setLoading(true)
    const [c, p, dl] = await Promise.all([
      adminService.getClients(),
      adminService.getPlans(),
      supabase.from('client_deadlines').select('client_id, deadline_date, photos_sent_at'),
    ])
    setClients(c)
    setPlans(p.filter((pl: any) => pl.is_active))
    const dlMap: Record<string, DeadlineData> = {}
    ;(dl.data || []).forEach((d: any) => { dlMap[d.client_id] = { deadline_date: d.deadline_date, photos_sent_at: d.photos_sent_at } })
    setDeadlines(dlMap)
    setLoading(false)
  }

  const handleCreate = async () => {
    if (!form.full_name || !form.email || !form.birth_date || !form.plan_id)
      return alert('Preencha nome, e-mail, data de nascimento e plano.')
    try {
      const client = await adminService.createClient(form as any)
      setCreating(false)
      setForm({ full_name: '', email: '', phone: '', birth_date: '', plan_id: '', notes: '' })
      navigate(`/admin/clients/${client.id}`)
    } catch (e: any) { alert(e.message) }
  }

  const handleArchive = useCallback((id: string) => setArchivedIds(prev => new Set([...prev, id])), [])
  const handleRestore = useCallback((id: string) => setArchivedIds(prev => { const s = new Set(prev); s.delete(id); return s }), [])
  const handleStar = useCallback((id: string) => setStarredIds(prev => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s }), [])
  const handleDelete = async (id: string) => {
    const client = clients.find(c => c.id === id)
    if (!client) return
    if (!confirm(`Excluir "${client.full_name}"? Todos os dados e arquivos serão removidos.`)) return
    await adminService.deleteClient(id); load()
  }
  const toggleCollapse = useCallback((key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] })), [])

  const activeClients = useMemo(() => clients.filter(c => !archivedIds.has(c.id)), [clients, archivedIds])
  const archivedClients = useMemo(() => clients.filter(c => archivedIds.has(c.id)), [clients, archivedIds])

  const filteredActive = useMemo(() => {
    let list = activeClients
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(c => c.full_name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || (c.phone && c.phone.toLowerCase().includes(q)))
    }
    if (filter === 'danger') list = list.filter(c => getDeadlineInfo(c, deadlines[c.id])?.urgency === 'danger')
    else if (COL_ORDER.includes(filter)) list = list.filter(c => c.status === filter)
    return list
  }, [activeClients, search, filter, deadlines])

  const groupedByStatus = useMemo(() => {
    const groups: Record<string, Client[]> = {}
    COL_ORDER.forEach(s => { groups[s] = [] })
    filteredActive.forEach(c => { if (groups[c.status]) groups[c.status].push(c) })
    Object.keys(groups).forEach(status => {
      groups[status].sort((a, b) => {
        const dlA = deadlines[a.id]; const dlB = deadlines[b.id]
        if (dlA && !dlB) return -1; if (!dlA && dlB) return 1; if (!dlA && !dlB) return 0
        return new Date(dlA.deadline_date).getTime() - new Date(dlB.deadline_date).getTime()
      })
    })
    return groups
  }, [filteredActive, deadlines])

  const isArchiveView = filter === 'archived'
  const btnStyle = (active: boolean) => ({
    background: active ? t.surface : 'none', border: 'none', cursor: 'pointer', padding: '5px 8px', borderRadius: 6,
    color: active ? t.text : t.text2, display: 'flex', alignItems: 'center', gap: 5,
    fontSize: 13, fontWeight: active ? 600 : 400, boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
  })

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0', background: t.bg }}>
      <div className="animate-spin h-8 w-8 border-2 border-rose-400 border-t-transparent rounded-full" />
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', background: t.bg, fontFamily: 'system-ui,-apple-system,sans-serif', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ background: t.surface, borderBottom: `2px solid ${t.border}`, padding: '0 14px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, height: 52 }}>
        <button onClick={onOpenNav} title="Menu de navegação"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 8px', borderRadius: 8, color: t.text2, display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0, transition: 'background 0.15s' }}
          onMouseEnter={e => (e.currentTarget.style.background = t.surface2)}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >
          <span style={{ display: 'block', width: 18, height: 2, background: 'currentColor', borderRadius: 2 }} />
          <span style={{ display: 'block', width: 14, height: 2, background: 'currentColor', borderRadius: 2 }} />
          <span style={{ display: 'block', width: 18, height: 2, background: 'currentColor', borderRadius: 2 }} />
        </button>

        <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: 'linear-gradient(135deg, #e91e63, #ff6090)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(233,30,99,0.3)' }}>
          <Palette size={14} color="white" />
        </div>
        <div style={{ width: 1, height: 22, background: t.border, flexShrink: 0, margin: '0 2px' }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: t.text, letterSpacing: -0.3 }}>Clientes</span>
          <span style={{ fontSize: 12, color: t.text3, marginLeft: 8, fontWeight: 500 }}>
            {activeClients.length} ativa{activeClients.length !== 1 ? 's' : ''}
            {filteredActive.length !== activeClients.length && !isArchiveView &&
              <span style={{ color: t.accent, marginLeft: 4 }}>· {filteredActive.length} filtrada{filteredActive.length !== 1 ? 's' : ''}</span>
            }
          </span>
        </div>

        {!isArchiveView && viewMode === 'board' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }} className="hidden md:flex">
            {COL_ORDER.map(key => {
              const cfg = STATUSES[key]
              const count = groupedByStatus[key]?.length || 0
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: cfg.color }} />
                  <span style={{ fontSize: 12, fontWeight: count > 0 ? 700 : 400, color: count > 0 ? t.text : t.text3 }}>{count}</span>
                </div>
              )
            })}
          </div>
        )}

        <div ref={themeRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button onClick={() => setThemeOpen(v => !v)} title="Tema"
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface2, cursor: 'pointer', fontSize: 13, color: t.text2, transition: 'background 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.background = t.surface)}
            onMouseLeave={e => (e.currentTarget.style.background = t.surface2)}
          >
            <span style={{ fontSize: 15 }}>{THEMES[themeName].icon}</span><ChevronDown size={11} />
          </button>
          {themeOpen && (
            <div style={{ position: 'absolute', right: 0, top: 38, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 200, overflow: 'hidden', minWidth: 140 }}>
              <div style={{ padding: '8px 12px 4px' }}>
                <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: t.text3, textTransform: 'uppercase' as const, letterSpacing: 1 }}>Tema</p>
              </div>
              {(Object.entries(THEMES) as [ThemeName, Theme][]).map(([key, th]) => (
                <button key={key} onClick={() => { setThemeName(key); setThemeOpen(false) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 14px', background: themeName === key ? t.accentLight : 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: themeName === key ? t.accent : t.text, textAlign: 'left', fontWeight: themeName === key ? 700 : 400 }}
                  onMouseEnter={e => { if (themeName !== key) (e.currentTarget as HTMLButtonElement).style.background = t.surface2 }}
                  onMouseLeave={e => { if (themeName !== key) (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
                ><span style={{ fontSize: 15 }}>{th.icon}</span> {th.name}</button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', background: t.surface2, borderRadius: 8, padding: 2, flexShrink: 0 }}>
          <button onClick={() => setViewMode('board')} title="Kanban" style={btnStyle(viewMode === 'board')}><LayoutGrid size={15} /></button>
          <button onClick={() => setViewMode('list')} title="Lista" style={btnStyle(viewMode === 'list')}><List size={15} /></button>
        </div>

        <button onClick={() => setSidebarOpen(v => !v)} title={sidebarOpen ? 'Fechar painel' : 'Abrir painel de filtros'}
          style={{ background: sidebarOpen ? t.accentLight : 'none', border: `1px solid ${sidebarOpen ? t.accent + '40' : t.border}`, cursor: 'pointer', padding: '6px 8px', borderRadius: 8, color: sidebarOpen ? t.accent : t.text2, display: 'flex', flexShrink: 0, transition: 'all 0.15s' }}
          onMouseEnter={e => (e.currentTarget.style.background = sidebarOpen ? t.accentLight : t.surface2)}
          onMouseLeave={e => (e.currentTarget.style.background = sidebarOpen ? t.accentLight : 'none')}
        ><SlidersHorizontal size={16} /></button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <KanbanSidebar theme={t} clients={activeClients} search={search} onSearch={setSearch}
          filter={filter} onFilter={setFilter} sidebarOpen={sidebarOpen} onToggle={() => setSidebarOpen(v => !v)}
          total={activeClients.length} archivedCount={archivedClients.length} deadlines={deadlines} />

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {isArchiveView && (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <ArchiveView clients={archivedClients} theme={t} onRestore={handleRestore} onDelete={handleDelete} />
            </div>
          )}

          {!isArchiveView && viewMode === 'board' && (
            <>
              {filteredActive.length === 0 && !search && filter === 'all' ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, color: t.text3 }}>
                  <User size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
                  <p style={{ fontSize: 14, margin: 0, color: t.text2 }}>Nenhuma cliente cadastrada ainda</p>
                  <p style={{ fontSize: 12, margin: '4px 0 0', color: t.text3 }}>As clientes aparecerão aqui após o cadastro</p>
                </div>
              ) : (
                <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', padding: '16px 20px 20px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  {COL_ORDER.map(key => (
                    <KanbanColumn key={key} statusKey={key} clients={groupedByStatus[key] || []} deadlines={deadlines} starredIds={starredIds} theme={t}
                      collapsed={!!collapsed[key]} onToggleCollapse={() => toggleCollapse(key)}
                      onView={id => navigate(`/admin/clients/${id}`)} onArchive={handleArchive} onDelete={handleDelete} onStar={handleStar} />
                  ))}
                </div>
              )}
            </>
          )}

          {!isArchiveView && viewMode === 'list' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {filteredActive.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, color: t.text3 }}>
                  <User size={36} style={{ marginBottom: 10, opacity: 0.4 }} />
                  <p style={{ fontSize: 14, margin: 0, color: t.text2 }}>{search || filter !== 'all' ? 'Nenhuma cliente encontrada' : 'Nenhuma cliente cadastrada'}</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[...filteredActive].sort((a, b) => {
                    const dlA = deadlines[a.id]; const dlB = deadlines[b.id]
                    if (dlA && !dlB) return -1; if (!dlA && dlB) return 1; if (!dlA && !dlB) return 0
                    return new Date(dlA.deadline_date).getTime() - new Date(dlB.deadline_date).getTime()
                  }).map(client => {
                    const cfg = STATUSES[client.status]
                    const dl = getDeadlineInfo(client, deadlines[client.id])
                    return (
                      <div key={client.id}
                        style={{ background: t.cardBg, border: `1px solid ${dl?.urgency === 'danger' ? '#fca5a5' : client.status === 'photos_submitted' ? '#fbcfe8' : t.cardBorder}`, borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: 'pointer' }}
                        onClick={() => navigate(`/admin/clients/${client.id}`)}
                        onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = t.accent + '60'}
                        onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = dl?.urgency === 'danger' ? '#fca5a5' : client.status === 'photos_submitted' ? '#fbcfe8' : t.cardBorder}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                          <div style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, background: getAvatarColor(client.full_name)[0], color: getAvatarColor(client.full_name)[1], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>
                            {getInitials(client.full_name)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
                              <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{client.full_name}</span>
                              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: cfg?.bg, color: cfg?.textColor, fontWeight: 600 }}>{cfg?.label}</span>
                              {starredIds.has(client.id) && <span style={{ fontSize: 11, color: '#f59e0b' }}>★</span>}
                              {dl && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 600, background: dl.urgency === 'danger' ? '#fee2e2' : '#fef3c7', color: dl.urgency === 'danger' ? '#991b1b' : '#92400e' }}>📅 {dl.label}</span>}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 3 }}>
                              <span style={{ fontSize: 12, color: t.text2, display: 'flex', alignItems: 'center', gap: 4 }}><Mail size={11} color={t.text3} /> {client.email}</span>
                              {client.phone && <span style={{ fontSize: 12, color: t.text2, display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={11} color={t.text3} /> {client.phone}</span>}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                          <button onClick={() => handleStar(client.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: starredIds.has(client.id) ? '#f59e0b' : t.text3 }} title={starredIds.has(client.id) ? 'Remover estrela' : 'Destacar'}><Star size={15} /></button>
                          <button onClick={() => navigate(`/admin/clients/${client.id}`)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, border: `1px solid ${t.border}`, background: 'none', cursor: 'pointer', fontSize: 12, color: t.text2 }}
                            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = t.surface2}
                            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'none'}
                          ><Eye size={13} /> Ver</button>
                          <button onClick={() => handleArchive(client.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: t.text3 }} title="Arquivar"><Archive size={14} /></button>
                          <button onClick={() => handleDelete(client.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: '#ef4444' }} title="Excluir"><Trash2 size={14} /></button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Form Response Modal ──────────────────────────────────────────────────
function FormResponseModal({ formSubmission, planForm, onClose }: {
  formSubmission: any; planForm: any; onClose: () => void
}) {
  const formData = formSubmission?.form_data || {}
  const fields: any[] = (planForm?.fields || []).sort((a: any, b: any) => a.order - b.order)
  const fieldMap = Object.fromEntries(fields.map((f: any) => [f.id, f]))
  const [generatingPDF, setGeneratingPDF] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  const isImageUrl = (val: any): boolean =>
    typeof val === 'string' && (val.startsWith('http') || val.startsWith('blob:') || val.startsWith('data:image'))

  const getImageUrls = (value: any): string[] => {
    if (!value) return []
    if (typeof value === 'string' && isImageUrl(value)) return [value]
    if (Array.isArray(value)) {
      // Novo formato salvo pelo ImageUploadFormField: [{storagePath, url}]
      if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null && 'url' in value[0]) {
        return (value as { url: string }[]).map(v => v.url).filter(isImageUrl)
      }
      // Formato legado: array de strings de URL
      return value.filter(isImageUrl)
    }
    return []
  }

  const getTextValue = (value: any): string => {
    if (value === null || value === undefined || value === '') return '—'
    if (Array.isArray(value)) return value.join(', ')
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  const fetchBase64 = async (url: string): Promise<string | null> => {
    try {
      const resp = await fetch(url)
      const blob = await resp.blob()
      return await new Promise((res, rej) => {
        const reader = new FileReader()
        reader.onload = () => res(reader.result as string)
        reader.onerror = rej
        reader.readAsDataURL(blob)
      })
    } catch { return null }
  }

  const handleDownloadPDF = async () => {
    setGeneratingPDF(true)
    try {
      const { default: jsPDF } = await import('jspdf')
      const pdf = new jsPDF()
      const pageW = pdf.internal.pageSize.width
      const pageH = pdf.internal.pageSize.height
      const margin = 20
      const maxW = pageW - margin * 2
      let y = 20

      const checkPage = (space = 20) => {
        if (y + space > pageH - margin) { pdf.addPage(); y = margin }
      }
      const hline = () => {
        pdf.setDrawColor(220, 220, 220)
        pdf.line(margin, y, pageW - margin, y)
        y += 6
      }

      // Cabeçalho
      pdf.setFontSize(9); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(130, 130, 130)
      const dateStr = formSubmission?.submitted_at
        ? new Date(formSubmission.submitted_at).toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        : ''
      pdf.text(dateStr, pageW - margin - pdf.getTextWidth(dateStr), y); y += 10

      pdf.setFontSize(18); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(0, 0, 0)
      pdf.text('Coloração Pessoal Online', margin, y); y += 8
      pdf.setFontSize(12); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(80, 80, 80)
      pdf.text('Formulário', margin, y); y += 10
      hline()

      // Campos ordenados
      const ordered: [string, any][] = [
        ...fields.filter((f: any) => formData[f.id] !== undefined).map((f: any) => [f.id, formData[f.id]] as [string, any]),
        ...Object.keys(formData).filter(k => !fieldMap[k]).map(k => [k, formData[k]] as [string, any]),
      ]

      for (let i = 0; i < ordered.length; i++) {
        const [key, value] = ordered[i]
        const field = fieldMap[key]
        const label = field?.label || key
        const imgUrls = getImageUrls(value)
        const isImg = field?.type === 'image' || imgUrls.length > 0

        checkPage(30)

        // Pergunta em bold azul-escuro
        pdf.setFontSize(11); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(30, 40, 80)
        const qLines = pdf.splitTextToSize(`${i + 1}. ${label}`, maxW)
        qLines.forEach((line: string) => { checkPage(); pdf.text(line, margin, y); y += 6 })
        y += 2

        if (isImg) {
          if (imgUrls.length === 0) {
            pdf.setFontSize(10); pdf.setFont('helvetica', 'italic'); pdf.setTextColor(160, 160, 160)
            pdf.text('(Nenhuma imagem)', margin + 5, y); y += 8
          } else {
            for (const url of imgUrls) {
              const b64 = await fetchBase64(url)
              if (!b64) continue
              try {
                const props = pdf.getImageProperties(b64)
                const ratio = props.width / props.height
                const drawW = maxW
                const drawH = drawW / ratio
                checkPage(drawH + 10)
                pdf.addImage(b64, 'JPEG', margin, y, drawW, drawH)
                y += drawH + 8
              } catch { /* imagem inválida */ }
            }
          }
        } else {
          pdf.setFontSize(10); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(60, 60, 60)
          const lines = pdf.splitTextToSize(getTextValue(value), maxW - 10)
          lines.forEach((line: string) => { checkPage(); pdf.text(line, margin + 5, y); y += 6 })
          y += 4
        }

        if (i < ordered.length - 1) {
          pdf.setDrawColor(235, 235, 235)
          pdf.line(margin, y, pageW - margin, y)
          y += 8
        }
      }

      // Rodapé
      const total = (pdf as any).internal.pages.length - 1
      for (let p = 1; p <= total; p++) {
        pdf.setPage(p)
        pdf.setFontSize(9); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(160, 160, 160)
        const pg = `Página ${p} de ${total}`
        pdf.text(pg, pageW - margin - pdf.getTextWidth(pg), pageH - 10)
      }

      pdf.save('Formulario.pdf')
    } catch (err) {
      console.error('Erro ao gerar PDF:', err)
      alert('Erro ao gerar PDF. Tente novamente.')
    } finally {
      setGeneratingPDF(false)
    }
  }

  const orderedEntries: [string, any][] = [
    ...fields.filter((f: any) => formData[f.id] !== undefined).map((f: any) => [f.id, formData[f.id]] as [string, any]),
    ...Object.keys(formData).filter(k => !fieldMap[k]).map(k => [k, formData[k]] as [string, any]),
  ]

  return (
    <>
      {lightboxUrl && (
        <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4" onClick={() => setLightboxUrl(null)}>
          <button className="absolute top-4 right-4 text-white/70 hover:text-white" onClick={() => setLightboxUrl(null)}><X className="h-7 w-7" /></button>
          <img src={lightboxUrl} alt="Imagem ampliada" className="max-w-full max-h-full object-contain rounded-lg" onClick={e => e.stopPropagation()} />
        </div>
      )}

      <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
        <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-2xl max-h-[95dvh] sm:max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center"><ClipboardList className="h-5 w-5 text-blue-500" /></div>
              <div>
                <h2 className="font-semibold text-gray-900">Respostas do Formulário</h2>
                {formSubmission?.submitted_at && <p className="text-xs text-gray-400">Enviado em {new Date(formSubmission.submitted_at).toLocaleString('pt-BR')}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Btn variant="outline" size="sm" onClick={handleDownloadPDF} disabled={generatingPDF}>
                {generatingPDF
                  ? <><div className="animate-spin h-3.5 w-3.5 border-2 border-gray-400 border-t-transparent rounded-full" /> Gerando...</>
                  : <><Download className="h-3.5 w-3.5" /> Baixar PDF</>}
              </Btn>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-1"><X className="h-5 w-5" /></button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5 space-y-5">
            {orderedEntries.length === 0
              ? <p className="text-sm text-gray-400 text-center py-8">Sem respostas</p>
              : orderedEntries.map(([key, value], idx) => {
                const field = fieldMap[key]
                const label = field?.label || key
                const imgUrls = getImageUrls(value)
                const isImg = field?.type === 'image' || imgUrls.length > 0

                return (
                  <div key={key} className="border-b border-gray-100 pb-5 last:border-0 last:pb-0">
                    <p className="text-sm font-bold text-blue-900 mb-3">
                      {idx + 1}. {label}
                    </p>

                    {isImg ? (
                      imgUrls.length === 0
                        ? <p className="text-sm text-gray-400 italic">Nenhuma imagem enviada</p>
                        : (
                          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
                            {imgUrls.map((url, i) => (
                              <div key={i} className="relative group cursor-pointer rounded-xl overflow-hidden border border-gray-200 bg-gray-50"
                                onClick={() => setLightboxUrl(url)}>
                                <img
                                  src={url}
                                  alt={`Imagem ${i + 1}`}
                                  className="w-full object-cover"
                                  style={{ maxHeight: 220, objectFit: 'cover' }}
                                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                                  <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                                <a href={url} target="_blank" rel="noopener noreferrer"
                                  className="absolute bottom-2 right-2 bg-white/80 hover:bg-white rounded-lg p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={e => e.stopPropagation()} title="Abrir original">
                                  <ExternalLink className="h-3.5 w-3.5 text-gray-600" />
                                </a>
                              </div>
                            ))}
                          </div>
                        )
                    ) : (
                      <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{getTextValue(value)}</p>
                    )}
                  </div>
                )
              })
            }
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Photo Lightbox ───────────────────────────────────────────────────────
function PhotoLightbox({ photos, initialIndex, onClose }: { photos: any[]; initialIndex: number; onClose: () => void }) {
  const [index, setIndex] = useState(initialIndex)
  const [zoom, setZoom] = useState(1)
  const prev = useCallback(() => { setIndex(i => (i - 1 + photos.length) % photos.length); setZoom(1) }, [photos.length])
  const next = useCallback(() => { setIndex(i => (i + 1) % photos.length); setZoom(1) }, [photos.length])
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(); if (e.key === 'ArrowLeft') prev(); if (e.key === 'ArrowRight') next()
      if (e.key === '+' || e.key === '=') setZoom(z => Math.min(z + 0.5, 4)); if (e.key === '-') setZoom(z => Math.max(z - 0.5, 0.5))
    }
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler)
  }, [prev, next, onClose])
  const photo = photos[index]
  const handleDownload = async () => {
  try {
    const res = await fetch(photo.url)
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = photo.photo_name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(blobUrl)
  } catch {
    window.open(photo.url, '_blank')
  }
}
  return (
    <div className="fixed inset-0 bg-black/95 z-50 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 bg-black/40 flex-shrink-0" onClick={e => e.stopPropagation()}>
        <p className="text-white text-xs sm:text-sm font-medium truncate max-w-[40vw] sm:max-w-xs">{photo.photo_name}</p>
        <div className="flex items-center gap-1 sm:gap-2">
          <button onClick={() => setZoom(z => Math.max(z - 0.5, 0.5))} className="p-2.5 sm:p-2 text-white/70 hover:text-white active:bg-white/20 hover:bg-white/10 rounded-lg touch-manipulation"><ZoomOut className="h-5 w-5 sm:h-4 sm:w-4" /></button>
          <span className="text-white/70 text-xs w-10 text-center hidden sm:block">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(z + 0.5, 4))} className="p-2.5 sm:p-2 text-white/70 hover:text-white active:bg-white/20 hover:bg-white/10 rounded-lg touch-manipulation"><ZoomIn className="h-5 w-5 sm:h-4 sm:w-4" /></button>
          <button onClick={handleDownload} className="p-2.5 sm:p-2 text-white/70 hover:text-white active:bg-white/20 hover:bg-white/10 rounded-lg touch-manipulation"><Download className="h-5 w-5 sm:h-4 sm:w-4" /></button>
          <span className="text-white/40 text-xs px-1">{index + 1}/{photos.length}</span>
          <button onClick={onClose} className="p-2.5 sm:p-2 text-white/70 hover:text-white active:bg-white/20 hover:bg-white/10 rounded-lg touch-manipulation ml-1"><X className="h-5 w-5" /></button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center overflow-hidden relative" onClick={e => e.stopPropagation()}>
        {photos.length > 1 && <button onClick={prev} className="absolute left-2 sm:left-4 z-10 p-3 sm:p-3 bg-black/50 hover:bg-black/70 active:bg-black/80 rounded-full text-white touch-manipulation"><ChevronLeft className="h-6 w-6" /></button>}
        <img src={photo.url} alt={photo.photo_name} className="max-w-full max-h-full object-contain select-none transition-transform duration-200" style={{ transform: `scale(${zoom})`, cursor: zoom > 1 ? 'move' : 'default' }} draggable={false} />
        {photos.length > 1 && <button onClick={next} className="absolute right-2 sm:right-4 z-10 p-3 sm:p-3 bg-black/50 hover:bg-black/70 active:bg-black/80 rounded-full text-white touch-manipulation"><ChevronRight className="h-6 w-6" /></button>}
      </div>
      {photos.length > 1 && (
        <div className="flex-shrink-0 bg-black/60 py-2 sm:py-3 px-4" onClick={e => e.stopPropagation()}>
          <div className="flex gap-1.5 sm:gap-2 justify-center overflow-x-auto pb-1">
            {photos.map((p, i) => (
              <button key={p.id} onClick={() => { setIndex(i); setZoom(1) }} className={`flex-shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-lg overflow-hidden transition-all touch-manipulation ${i === index ? 'ring-2 ring-rose-400 opacity-100' : 'opacity-50 hover:opacity-80'}`}>
                <img src={p.url} alt={p.photo_name} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Photo Thumbnail ──────────────────────────────────────────────────────
function PhotoThumb({ photo, onClick }: { photo: any; onClick: () => void }) {
  const [visible, setVisible] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect() } },
      { rootMargin: '200px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className="relative aspect-square rounded-lg sm:rounded-xl overflow-hidden bg-gray-200 cursor-pointer group hover:ring-2 hover:ring-rose-400 transition-all touch-manipulation active:opacity-80"
      onClick={onClick}
    >
      {(!loaded || !visible) && !error && (
        <div className="absolute inset-0 bg-gray-200 animate-pulse" />
      )}
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
          <Camera className="h-6 w-6 text-gray-300" />
        </div>
      ) : visible ? (
        <img
          src={photo.url}
          alt={photo.photo_name}
          className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => { setError(true); setLoaded(true) }}
        />
      ) : null}
      {loaded && (
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
          <Maximize2 className="h-5 w-5 sm:h-6 sm:w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      )}
    </div>
  )
}

// ─── Photos View ──────────────────────────────────────────────────────────
function PhotosView({ clientId, photos, photoCategories }: { clientId: string; photos: any[]; photoCategories: any[] }) {
  const [photosWithUrls, setPhotosWithUrls] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [lightbox, setLightbox] = useState<{ photos: any[]; index: number } | null>(null)
  const [uploadingToCategory, setUploadingToCategory] = useState<string | null>(null)
  const [downloadingAll, setDownloadingAll] = useState<string | null>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [selectedCategoryForUpload, setSelectedCategoryForUpload] = useState<string | null>(null)

  const loadPhotos = useCallback(async () => {
    const p = await adminService.getClientPhotosWithUrls(clientId)
    setPhotosWithUrls(p)
    setLoading(false)
  }, [clientId])

  useEffect(() => { loadPhotos() }, [loadPhotos])

  const handleAdminUpload = async (categoryId: string, files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploadingToCategory(categoryId)
    try {
      for (const file of Array.from(files)) {
        const uniqueName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        const path = `${clientId}/${uniqueName}`

        const { error: uploadError } = await supabase.storage
          .from('client-photos')
          .upload(path, file, { contentType: file.type, upsert: false })
        if (uploadError) throw uploadError

        const { error: dbError } = await supabase
          .from('client_photos')
          .insert({
            client_id: clientId,
            photo_name: uniqueName,
            photo_type: file.type,
            photo_size: file.size,
            storage_path: path,
            category_id: categoryId,
            uploaded_at: new Date().toISOString()
          })
        if (dbError) throw dbError
      }
      await loadPhotos()
    } catch (e: any) {
      alert(`Erro ao fazer upload: ${e.message}`)
    } finally {
      setUploadingToCategory(null)
      setSelectedCategoryForUpload(null)
      if (uploadInputRef.current) uploadInputRef.current.value = ''
    }
  }

  if (loading) return (
    <div className="space-y-5">
      <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 flex items-center gap-3">
        <div className="w-10 h-10 bg-violet-200 rounded-lg animate-pulse flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-40 bg-violet-200 rounded animate-pulse" />
          <div className="h-2.5 w-56 bg-violet-100 rounded animate-pulse" />
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="space-y-1.5">
            <div className="h-4 w-36 bg-gray-200 rounded animate-pulse" />
            <div className="h-3 w-16 bg-gray-100 rounded animate-pulse" />
          </div>
          <div className="h-8 w-24 bg-gray-100 rounded-lg animate-pulse" />
        </div>
        <div className="p-5">
          <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-1.5 sm:gap-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-lg sm:rounded-xl bg-gray-200 animate-pulse" style={{ animationDelay: `${i * 40}ms` }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
  
  const photosByCat: Record<string, any[]> = {}
  const uncategorized: any[] = []
  photosWithUrls.forEach(p => { if (p.category_id) { if (!photosByCat[p.category_id]) photosByCat[p.category_id] = []; photosByCat[p.category_id].push(p) } else uncategorized.push(p) })
  const downloadAll = async (catPhotos: any[], label: string) => {
    if (downloadingAll) return
    setDownloadingAll(label)
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      const folder = zip.folder(label) ?? zip
      await Promise.all(
        catPhotos.map(async (p) => {
          try {
            const res = await fetch(p.url)
            const blob = await res.blob()
            folder.file(p.photo_name, blob)
          } catch { /* pula foto com erro */ }
        })
      )
      const blob = await zip.generateAsync({ type: 'blob' })
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = `${label}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    } catch (e: any) {
      alert(`Erro ao gerar ZIP: ${e.message}`)
    } finally {
      setDownloadingAll(null)
    }
  }
  const hasPhotos = photosWithUrls.length > 0

  const CategoryCard = ({ title, catPhotos, label }: { title: string; catPhotos: any[]; label: string }) => (
    <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="flex items-center gap-4 flex-1 min-w-0">
        <div className="w-12 h-12 bg-rose-50 rounded-xl flex items-center justify-center flex-shrink-0">
          <Camera className="h-6 w-6 text-rose-400" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 truncate">{title}</p>
          <p className="text-sm text-gray-400 mt-0.5">{catPhotos.length} foto{catPhotos.length !== 1 ? 's' : ''}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Btn variant="outline" size="sm" onClick={() => downloadAll(catPhotos, label)} loading={downloadingAll === label} disabled={downloadingAll !== null}>
          <Download className="h-3.5 w-3.5" /> ZIP
        </Btn>
        <Btn variant="primary" size="sm" onClick={() => setLightbox({ photos: catPhotos, index: 0 })}>
          <Eye className="h-3.5 w-3.5" /> Ver Fotos
        </Btn>
      </div>
    </div>
  )

  return (
    <>
      <div className="space-y-3">
        {/* Adicionar fotos */}
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-3 flex-1">
            <div className="w-10 h-10 bg-violet-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <Upload className="h-5 w-5 text-violet-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-violet-900">Adicionar fotos complementares</p>
              <p className="text-xs text-violet-600 mt-0.5">Faça upload de fotos adicionais pelo admin</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {photoCategories.length > 0 && (
              <select
                value={selectedCategoryForUpload || ''}
                onChange={e => setSelectedCategoryForUpload(e.target.value || null)}
                className="flex-1 sm:flex-none px-3 py-2 border border-violet-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white min-w-0"
              >
                <option value="">Sem categoria</option>
                {photoCategories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.title}</option>
                ))}
              </select>
            )}
            <input ref={uploadInputRef} type="file" multiple accept="image/*" className="hidden"
              onChange={e => handleAdminUpload(selectedCategoryForUpload || '__none__', e.target.files)} />
            <Btn variant="primary" size="sm" onClick={() => uploadInputRef.current?.click()} loading={uploadingToCategory !== null} className="whitespace-nowrap">
              <Upload className="h-3.5 w-3.5" /> Adicionar Fotos
            </Btn>
          </div>
        </div>

        {/* Cards por categoria */}
        {photoCategories.map(cat => {
          const catPhotos = photosByCat[cat.id] || []
          if (catPhotos.length === 0) return null
          return <CategoryCard key={cat.id} title={cat.title} catPhotos={catPhotos} label={cat.title} />
        })}
        {uncategorized.length > 0 && (
          <CategoryCard title="Fotos sem categoria" catPhotos={uncategorized} label="Fotos" />
        )}

        {!hasPhotos && (
          <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center">
            <Camera className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">Nenhuma foto enviada ainda</p>
            <p className="text-xs text-gray-400 mt-2">Use o botão acima para adicionar fotos</p>
          </div>
        )}
      </div>
      {lightbox && <PhotoLightbox photos={lightbox.photos} initialIndex={lightbox.index} onClose={() => setLightbox(null)} />}
    </>
  )
}

// ─── Folder Picker ────────────────────────────────────────────────────────
function FolderPicker({ folders, linkedFolderId, onSelect }: {
  folders: any[]
  linkedFolderId: string | null
  onSelect: (id: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const selectedFolder = folders.find((f: any) => f.id === linkedFolderId)
  const filtered = folders.filter((f: any) => f.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all ${
          open ? 'border-violet-400 ring-2 ring-violet-100' : 'border-gray-200 hover:border-violet-200'
        } bg-white`}
      >
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${selectedFolder ? 'bg-violet-100' : 'bg-gray-100'}`}>
          <FolderOpen className={`h-4 w-4 ${selectedFolder ? 'text-violet-600' : 'text-gray-400'}`} />
        </div>
        <div className="flex-1 min-w-0">
          {selectedFolder ? (() => {
            const cfg = typeof selectedFolder.config === 'string' ? JSON.parse(selectedFolder.config) : selectedFolder.config
            return (
              <>
                <p className="text-sm font-semibold text-violet-800">{selectedFolder.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{cfg?.categories?.length || 0} cat · {cfg?.categories?.reduce((s: number, c: any) => s + (c.prompts?.length || 0), 0) || 0} prompts</p>
              </>
            )
          })() : (
            <p className="text-sm text-gray-400">Selecione uma pasta…</p>
          )}
        </div>
        <ChevronDown className={`h-4 w-4 text-gray-400 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-30 top-full mt-1.5 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden">
          {folders.length > 3 && (
            <div className="p-2 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar pasta..."
                  autoFocus
                  className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
              </div>
            </div>
          )}
          <div className="max-h-60 overflow-y-auto">
            <button
              onClick={() => { onSelect(null); setOpen(false) }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${linkedFolderId === null ? 'bg-violet-50' : 'hover:bg-gray-50'}`}
            >
              <div className="w-7 h-7 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <FolderOpen className="h-3.5 w-3.5 text-gray-400" />
              </div>
              <span className="text-sm text-gray-500 flex-1">Nenhuma pasta vinculada</span>
              {linkedFolderId === null && <Check className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" />}
            </button>
            {filtered.map((f: any) => {
              const cfg = typeof f.config === 'string' ? JSON.parse(f.config) : f.config
              const isLinked = linkedFolderId === f.id
              return (
                <button
                  key={f.id}
                  onClick={() => { onSelect(f.id); setOpen(false); setSearch('') }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${isLinked ? 'bg-violet-50' : 'hover:bg-gray-50'}`}
                >
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${isLinked ? 'bg-violet-100' : 'bg-gray-50'}`}>
                    <FolderOpen className={`h-3.5 w-3.5 ${isLinked ? 'text-violet-600' : 'text-gray-400'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${isLinked ? 'text-violet-800' : 'text-gray-700'}`}>{f.name}</p>
                    <p className="text-xs text-gray-400">{cfg?.categories?.length || 0} cat · {cfg?.categories?.reduce((s: number, c: any) => s + (c.prompts?.length || 0), 0) || 0} prompts</p>
                  </div>
                  {cfg?.driveLink && (
                    <a href={cfg.driveLink} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-xs text-violet-500 hover:text-violet-700 flex-shrink-0 p-1">
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {isLinked && <Check className="h-3.5 w-3.5 text-violet-600 flex-shrink-0" />}
                </button>
              )
            })}
            {filtered.length === 0 && search && <p className="text-xs text-gray-400 text-center py-5">Nenhuma pasta encontrada</p>}
            {folders.length === 0 && !search && <p className="text-xs text-gray-400 text-center py-5">Crie pastas em <strong>Pastas IA</strong> para vincular aqui</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Client Detail ────────────────────────────────────────────────────────
function ClientDetail({ onOpenNav }: { onOpenNav?: () => void }) {
  const { clientId } = useParams<{ clientId: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(window.innerWidth >= 768)
  const [copied, setCopied] = useState(false)
  const [tab, setTab] = useState<'overview' | 'photos' | 'result' | 'ai'>('overview')
  const [showFormModal, setShowFormModal] = useState(false)
  const [resultForm, setResultForm] = useState({ observations: '' })
  const [savingResult, setSavingResult] = useState(false)
  const [releasingResult, setReleasingResult] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [aiFolders, setAiFolders] = useState<any[]>([])
  const [tagTemplates, setTagTemplates] = useState<any[]>([])
  const [clientTags, setClientTags] = useState<{ templateId: string; name: string; value: string }[]>([])
  const [linkedFolderId, setLinkedFolderId] = useState<string | null>(null)
  const [linkedFolderConfig, setLinkedFolderConfig] = useState<any>(null)
  const [savingAI, setSavingAI] = useState(false)
  const [aiSaveStatus, setAiSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [notes, setNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [notesSaved, setNotesSaved] = useState(false)
  const [approvingPhotos, setApprovingPhotos] = useState(false)   // NEW
  const [showRejection, setShowRejection] = useState(false)
  const [rejectingPhotos, setRejectingPhotos] = useState(false)
  const [editingDeadline, setEditingDeadline] = useState(false)
  const [deadlineInput, setDeadlineInput] = useState('')
  const [savingDeadline, setSavingDeadline] = useState(false)
  const [chatEnabled, setChatEnabled] = useState(true)

  useEffect(() => { load() }, [clientId])

  const buildSystemPrompt = (name: string, folderConfig: any, tags: { name: string; value: string }[]): string => {
    const filled = tags.filter(t => t.value.trim())
    let tagSection = ''
    if (filled.length > 0) tagSection = `\n═══ INFORMAÇÕES DA ANÁLISE DESTA CLIENTE ═══\n${filled.map(t => `${t.name}: ${t.value}`).join('\n')}\n\nUse ESTAS informações como base para TODAS as respostas.`
    if (!folderConfig && !filled.length) return ''
    let categoriesSection = ''
    if (folderConfig) {
      const catLines = (folderConfig.categories || []).map((cat: any) => { const prompts = (cat.prompts || []).map((p: any) => { let d = '  - ' + p.name; if (p.options?.length) d += ' [' + p.options.join(', ') + ']'; if (p.instructions) d += ' → ' + p.instructions; return d }).join('\n'); return '📌 ' + cat.name + ':\n' + (prompts || '  (vazio)') }).join('\n\n')
      categoriesSection = '\n═══ CATEGORIAS ═══\n' + catLines
    }
    return ['Você é a "MS Color IA", assistente virtual de coloração pessoal.', 'Atende a cliente ' + name + '.', '', '═══ REGRAS ABSOLUTAS ═══', '1. FOTO: Já está anexada. NUNCA peça foto.', '2. ROSTO: Mantenha feições idênticas ao gerar imagens.', '3. RESPOSTAS: Baseie-se EXCLUSIVAMENTE nas informações abaixo.', '4. ESCOPO: Só coloração pessoal, moda, estilo, cabelo, maquiagem, acessórios.', '5. TOM: Entusiasmada, positiva. Português brasileiro.', tagSection, categoriesSection, '═══ GERAÇÃO ═══', '- Use a foto da categoria correta (cabelo/roupa/geral) como base.'].join('\n')
  }

  const load = async () => {
    if (!clientId) return
    setLoading(true)
    const [detail, foldersRes, templatesRes] = await Promise.all([
      adminService.getClientDetail(clientId),
      supabase.from('ai_folders').select('id, name, config').order('name'),
      supabase.from('ai_info_templates').select('id, name, options').order('sort_order'),
    ])
    setData(detail)
    setNotes(detail.client.notes || '')
    if (detail.result) setResultForm({ observations: detail.result.observations || '' })
    if (detail.result) setChatEnabled(detail.result.chat_enabled ?? true)
    const folders = foldersRes.data || []
    setAiFolders(folders)
    const tpls = (templatesRes.data || []).map((t: any) => ({ ...t, options: Array.isArray(t.options) ? t.options : [] }))
    setTagTemplates(tpls)
    const folderId = detail.client.ai_folder_id || null
    setLinkedFolderId(folderId)
    if (folderId) { const fc = folders.find((f: any) => f.id === folderId); setLinkedFolderConfig(fc ? (typeof fc.config === 'string' ? JSON.parse(fc.config) : fc.config) : null) }
    const savedTags: any[] = detail.client.ai_info_tags || []
    setClientTags(tpls.map((t: any) => { const saved = savedTags.find((s: any) => s.templateId === t.id); return { templateId: t.id, name: t.name, value: saved?.value || '' } }))
    setLoading(false)
  }

  const handleSaveNotes = async () => {
    setSavingNotes(true)
    try { await adminService.updateClient(clientId!, { notes } as any); setNotesSaved(true); setTimeout(() => setNotesSaved(false), 2000) }
    catch (e: any) { alert(e.message) } finally { setSavingNotes(false) }
  }

  // Approva fotos + formulário e inicia análise
  const handleApprovePhotos = async () => {
    const clientName = data?.client?.full_name ?? 'esta cliente'
    const hasForm = !!formSubmission
    const photosCount = photos.length

    if (photosCount === 0) {
      alert('Nenhuma foto enviada ainda.')
      return
    }

    const formWarning = hasForm
      ? ''
      : '\n\n⚠️ O formulário ainda não foi enviado pela cliente. Deseja aprovar mesmo assim?'

    if (!confirm(
      `Aprovar fotos e formulário de ${clientName}?${formWarning}\n\nIsso irá:\n• Mover para "Análise em Andamento"\n• Definir o prazo de entrega\n• Enviar e-mail de confirmação para a cliente`
    )) return

    setApprovingPhotos(true)
    try {
      const deadlineDays = (data?.client as any)?.plan?.deadline_days ?? 5
      await adminService.approvePhotos(clientId!, deadlineDays)
      load()
    } catch (e: any) { alert(e.message) } finally { setApprovingPhotos(false) }
  }

  const handleReject = async (payload: {
    rejectForm: boolean; formReason: string
    rejectPhotos: boolean; photosReason: string
  }) => {
    const id = clientId!
    if (payload.rejectForm && payload.rejectPhotos)
      await adminService.rejectBoth(id, payload.formReason, payload.photosReason)
    else if (payload.rejectForm)
      await adminService.rejectForm(id, payload.formReason)
    else
      await adminService.rejectPhotos(id, payload.photosReason)
    setShowRejection(false)
    load()
  }

  const handleSaveDeadline = async () => {
    if (!deadlineInput) return
    setSavingDeadline(true)
    try { await supabase.from('client_deadlines').update({ deadline_date: deadlineInput }).eq('client_id', clientId!); setEditingDeadline(false); load() }
    catch (e: any) { alert(e.message) } finally { setSavingDeadline(false) }
  }

  const copyLink = () => { const link = `${window.location.origin}/c/${data.client.token}`; navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  const handleSaveResult = async () => { setSavingResult(true); try { await adminService.saveResult(clientId!, resultForm) } catch (e: any) { alert(e.message) } finally { setSavingResult(false) } }
  const handleReleaseResult = async () => {
    const hasContent = resultForm.observations.trim() || resultFiles?.length > 0 || linkedFolderId
    if (!hasContent) { if (!confirm('⚠️ Nenhum conteúdo adicionado.\n\nDeseja liberar mesmo assim?')) return } else { if (!confirm('Liberar o resultado para a cliente?')) return }
    setReleasingResult(true); try { await adminService.releaseResult(clientId!, { chatEnabled }); load() } catch (e: any) { alert(e.message) } finally { setReleasingResult(false) }
  }
  const handleSaveChatEnabled = async () => {
    const { error } = await supabase.from('client_results').upsert(
      { client_id: clientId!, chat_enabled: chatEnabled, updated_at: new Date().toISOString() },
      { onConflict: 'client_id' }
    )
    if (error) throw error
  }
  const handleSaveAIConfig = async () => {
    setSavingAI(true); setAiSaveStatus('idle')
    try {
      const prompt = buildSystemPrompt(data.client.full_name, linkedFolderConfig, clientTags)
      await supabase.from('clients').update({ ai_folder_id: linkedFolderId, ai_info_tags: clientTags, ai_prompt: prompt }).eq('id', clientId)
      const driveLink = linkedFolderConfig?.driveLink || ''
      if (driveLink) await adminService.saveResult(clientId!, { ...resultForm, folder_url: driveLink })
      setAiSaveStatus('saved'); setTimeout(() => setAiSaveStatus('idle'), 3000)
    } catch { setAiSaveStatus('error') } finally { setSavingAI(false) }
  }
  const handleLinkFolder = async (folderId: string | null) => { setLinkedFolderId(folderId); if (folderId) { const fc = aiFolders.find((f: any) => f.id === folderId); const config = fc ? (typeof fc.config === 'string' ? JSON.parse(fc.config) : fc.config) : null; setLinkedFolderConfig(config) } else { setLinkedFolderConfig(null) } }
  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (!file) return; setUploadingFile(true); try { await adminService.uploadResultFile(clientId!, file); load() } catch (e: any) { alert(e.message) } finally { setUploadingFile(false); if (fileInputRef.current) fileInputRef.current.value = '' } }
  const handleDeleteFile = async (fileId: string, storagePath: string) => { if (!confirm('Remover este arquivo?')) return; await adminService.deleteResultFile(fileId, storagePath); load() }

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin h-8 w-8 border-2 border-rose-400 border-t-transparent rounded-full" /></div>
  if (!data) return <div className="text-center py-20 text-gray-500">Cliente não encontrado</div>

  const { client, contract, formSubmission, photos, deadline, result, resultFiles, photoCategories, planForm } = data
  const status = STATUSES[client.status]
  const portalLink = `${window.location.origin}/c/${client.token}`

  return (
    <div className="flex flex-col h-full w-full" style={{ fontFamily: 'system-ui,-apple-system,sans-serif', background: '#f4f5f7' }}>
      {/* Topbar */}
      <div style={{ background: '#ffffff', borderBottom: '2px solid #dfe1e6', flexShrink: 0 }}>
        {/* Linha principal */}
        <div style={{ padding: '0 14px', display: 'flex', alignItems: 'center', gap: 8, height: 52 }}>
          <button onClick={onOpenNav} title="Menu" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 8px', borderRadius: 8, color: '#5e6c84', display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
            <span style={{ display: 'block', width: 18, height: 2, background: 'currentColor', borderRadius: 2 }} />
            <span style={{ display: 'block', width: 14, height: 2, background: 'currentColor', borderRadius: 2 }} />
            <span style={{ display: 'block', width: 18, height: 2, background: 'currentColor', borderRadius: 2 }} />
          </button>
          <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: 'linear-gradient(135deg, #e91e63, #ff6090)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(233,30,99,0.3)' }}>
            <Palette size={14} color="white" />
          </div>
          <div style={{ width: 1, height: 22, background: '#dfe1e6', flexShrink: 0, margin: '0 2px' }} />
          <button onClick={() => navigate('/admin/clients')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, padding: '4px 6px', borderRadius: 6, color: '#5e6c84', flexShrink: 0 }}>
            <ArrowLeft size={14} /><span style={{ fontSize: 14, fontWeight: 600, color: '#5e6c84' }} className="hidden sm:inline">Clientes</span>
          </button>
          <span style={{ fontSize: 14, color: '#97a0af', flexShrink: 0 }} className="hidden sm:block">/</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#172b4d', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{client.full_name}</span>
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 600, background: status?.bg, color: status?.textColor, flexShrink: 0 }} className="hidden sm:inline">{status?.short || status?.label}</span>

          {/* Approve buttons — desktop inline */}
          {client.status === 'photos_submitted' && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }} className="hidden sm:flex">
              <Btn variant="outline" size="sm" onClick={() => setShowRejection(true)} className="border-amber-300 text-amber-700 hover:bg-amber-50">
                <AlertTriangle className="h-3.5 w-3.5" /> Solicitar Ajustes
              </Btn>
              <Btn variant="pink" size="sm" onClick={handleApprovePhotos} loading={approvingPhotos}>
                <CheckCircle className="h-3.5 w-3.5" /> Aprovar e Iniciar Análise
              </Btn>
            </div>
          )}
        </div>

        {/* Linha de aprovação — mobile only */}
        {client.status === 'photos_submitted' && (
          <div className="sm:hidden flex gap-2 px-3 pb-2.5">
            <Btn variant="outline" size="sm" onClick={() => setShowRejection(true)} className="flex-1 justify-center border-amber-300 text-amber-700 hover:bg-amber-50">
              <AlertTriangle className="h-3.5 w-3.5" /> Ajustes
            </Btn>
            <Btn variant="pink" size="sm" onClick={handleApprovePhotos} loading={approvingPhotos} className="flex-1 justify-center">
              <CheckCircle className="h-3.5 w-3.5" /> Aprovar Análise
            </Btn>
          </div>
        )}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 sm:space-y-6 p-3 sm:p-6 max-w-3xl lg:max-w-5xl mx-auto w-full">

          {/* Header */}
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-rose-100 to-pink-100 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-rose-600 font-bold text-lg">{client.full_name[0].toUpperCase()}</span>
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold text-gray-900">{client.full_name}</h1>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: status?.bg, color: status?.textColor }}>{status?.label}</span>
                  {client.plan && <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 font-medium">{(client as any).plan.name}</span>}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-gray-500 mt-0.5">
                  <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" /><span className="truncate max-w-[180px] sm:max-w-none">{client.email}</span></span>
                  {client.phone && (
                    <span className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5" />
                      {client.phone}
                      <a 
                        href={`https://wa.me/55${client.phone.replace(/\D/g, '')}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="ml-0.5 text-green-600 hover:text-green-700"
                        title="Enviar mensagem no WhatsApp"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                      </a>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Portal link */}
          <div className="bg-gradient-to-br from-violet-50 to-purple-50 border border-violet-200 rounded-xl p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
                  <Link2 className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">Link de Acesso do Cliente</p>
                  <p className="text-xs text-gray-500">Compartilhe este link para o cliente acessar o portal</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Btn 
                  variant="outline" 
                  size="sm" 
                  onClick={copyLink}
                  className="bg-white hover:bg-violet-50 border-violet-300"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-green-600" />
                      <span className="hidden sm:inline">Copiado!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Copiar Link</span>
                    </>
                  )}
                </Btn>
                <a href={portalLink} target="_blank" rel="noopener noreferrer">
                  <Btn 
                    variant="outline" 
                    size="sm"
                    className="bg-white hover:bg-violet-50 border-violet-300"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Abrir Portal</span>
                  </Btn>
                </a>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl overflow-x-auto scrollbar-hide -mx-3 sm:mx-0 px-3 sm:px-1 w-auto sm:w-fit">
            {[
              { id: 'overview', label: 'Visão Geral' },
              { id: 'photos', label: `Fotos (${photos.length})` },
              { id: 'result', label: 'Resultado' },
              { id: 'documents', label: 'Documentos' },
              { id: 'ai', label: '✨ IA' },
            ].map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setTab(id as any)}
                className={`px-3 sm:px-4 py-2.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-colors touch-manipulation ${tab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700 active:bg-white/50'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Overview Tab */}
          {tab === 'overview' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Approve banner */}
              {client.status === 'photos_submitted' && (
                <div className="md:col-span-2 bg-gradient-to-r from-pink-50 to-rose-50 border border-rose-200 rounded-xl p-5 flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-pink-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <Camera className="h-5 w-5 text-pink-500" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-rose-900">Fotos recebidas — aguardando sua revisão</p>
                      <p className="text-xs text-rose-600 mt-0.5">Revise as fotos na aba <strong>Fotos</strong> e, quando estiver pronto, aprove para iniciar a análise e notificar a cliente.</p>
                    </div>
                  </div>
                  <Btn variant="outline" size="md" onClick={() => setShowRejection(true)} className="flex-shrink-0 border-amber-300 text-amber-700 hover:bg-amber-50">
                    <AlertTriangle className="h-4 w-4" /> Solicitar Ajustes
                  </Btn>
                  <Btn variant="pink" size="md" onClick={handleApprovePhotos} loading={approvingPhotos} className="flex-shrink-0">
                    <CheckCircle className="h-4 w-4" /> Aprovar Fotos
                  </Btn>
                </div>
              )}

              {/* Controle de Etapas */}
              <StageController
                client={client}
                contract={contract}
                formSubmission={formSubmission}
                photos={photos}
                result={result}
                onChange={load}
              />

              {/* Progresso */}
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h3 className="font-semibold text-gray-900 mb-4">Progresso</h3>
                <div className="space-y-3">
                  {[
                    { label: 'Contrato assinado', done: !!contract, date: contract?.signed_at },
                    { label: 'Formulário enviado', done: !!formSubmission, date: formSubmission?.submitted_at },
                    { label: `Fotos enviadas (${photos.length})`, done: photos.length > 0 && !['awaiting_contract', 'awaiting_form', 'awaiting_photos'].includes(client.status) },
                    {
                      label: 'Fotos aprovadas (revisão concluída)',
                      done: ['in_analysis', 'completed'].includes(client.status),
                      badge: client.status === 'photos_submitted' ? { text: 'Aguardando aprovação', color: 'text-pink-700 bg-pink-50 border border-pink-200' } : undefined,
                    },
                    { label: 'Análise em andamento', done: ['in_analysis', 'completed'].includes(client.status) },
                    { label: 'Resultado liberado', done: result?.is_released },
                  ].map(({ label, done, date, badge }: any) => (
                    <div key={label} className="flex items-center gap-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${done ? 'bg-green-100' : 'bg-gray-100'}`}>
                        {done ? <Check className="h-3.5 w-3.5 text-green-600" /> : <div className="w-2 h-2 rounded-full bg-gray-300" />}
                      </div>
                      <div className="flex-1 flex items-center gap-2 flex-wrap">
                        <span className={`text-sm ${done ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>{label}</span>
                        {date && <span className="text-xs text-gray-400">{new Date(date).toLocaleDateString('pt-BR')}</span>}
                        {badge && !done && <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.color}`}>{badge.text}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Prazo */}
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-gray-900">Prazo</h3>
                  {deadline?.deadline_date && !editingDeadline && client.status !== 'photos_submitted' && (
                    <Btn variant="outline" size="sm" onClick={() => { setDeadlineInput(deadline.deadline_date); setEditingDeadline(true) }}><Calendar className="h-3.5 w-3.5" /> Editar</Btn>
                  )}
                </div>
                {client.status === 'photos_submitted' ? (
                  <div className="flex items-start gap-2 bg-pink-50 rounded-lg p-3 border border-pink-100">
                    <Clock className="h-4 w-4 text-pink-400 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-pink-700">O prazo começa a contar após a aprovação das fotos.</p>
                  </div>
                ) : deadline?.deadline_date ? (
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">Fotos enviadas em</p>
                      <p className="text-sm font-medium text-gray-800">{new Date(deadline.photos_sent_at).toLocaleString('pt-BR')}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">Prazo de entrega</p>
                      {editingDeadline ? (
                        <div className="space-y-2">
                          <input type="date" value={deadlineInput} onChange={e => setDeadlineInput(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
                          <div className="flex gap-2">
                            <Btn size="sm" onClick={handleSaveDeadline} loading={savingDeadline}><Check className="h-3.5 w-3.5" /> Salvar</Btn>
                            <Btn variant="outline" size="sm" onClick={() => setEditingDeadline(false)}>Cancelar</Btn>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm font-medium text-gray-800">{formatDeadlineDate(deadline.deadline_date)}</p>
                          {client.status !== 'completed' && (() => {
                          const dias = calendarDaysUntil(deadline.deadline_date)
                          return (
                            <p className="text-xs text-orange-600 mt-0.5">
                              {dias === 0 ? 'Vence hoje' : `${dias} dia${dias !== 1 ? 's' : ''} restante${dias !== 1 ? 's' : ''}`}
                            </p>
                          )
                        })()}
                        </>
                      )}
                    </div>
                  </div>
                ) : <p className="text-sm text-gray-400">Prazo calculado após aprovação das fotos</p>}
              </div>

              {/* Observações internas */}
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900 flex items-center gap-2"><MessageSquare className="h-4 w-4 text-gray-400" /> Observações Internas</h3>
                  <Btn variant={notesSaved ? 'green' : 'outline'} size="sm" onClick={handleSaveNotes} loading={savingNotes} disabled={notes === (client.notes || '')}>
                    {notesSaved ? <><Check className="h-3.5 w-3.5" /> Salvo</> : <><Save className="h-3.5 w-3.5" /> Salvar</>}
                  </Btn>
                </div>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Anotações internas (não visível para a cliente)..."
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none bg-gray-50 focus:bg-white transition-colors" />
                {notes !== (client.notes || '') && <p className="text-xs text-amber-500 mt-1.5 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Alterações não salvas</p>}
              </div>

              {/* Formulário */}
              <div className={`border rounded-xl p-5 md:col-span-2 ${formSubmission ? 'bg-white border-gray-200' : 'bg-gray-50 border-dashed border-gray-300'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${formSubmission ? 'bg-blue-50' : 'bg-gray-100'}`}>
                      <ClipboardList className={`h-5 w-5 ${formSubmission ? 'text-blue-500' : 'text-gray-400'}`} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">Formulário</h3>
                      {formSubmission ? <p className="text-xs text-gray-400">Enviado em {new Date(formSubmission.submitted_at).toLocaleDateString('pt-BR')}</p> : <p className="text-xs text-gray-400">Aguardando envio do cliente</p>}
                    </div>
                  </div>
                  {formSubmission && <Btn variant="outline" size="sm" onClick={() => setShowFormModal(true)}><Eye className="h-3.5 w-3.5" /> Ver Respostas</Btn>}
                </div>
              </div>
            </div>
          )}

          {tab === 'photos' && <PhotosView clientId={clientId!} photos={photos} photoCategories={photoCategories} />}

          {tab === 'documents' && <ClientDocumentsTab clientId={clientId!} />}

          {tab === 'result' && (
            <div className="space-y-5">
              {result?.is_released ? (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                  <div><p className="text-sm font-medium text-green-800">Resultado liberado</p><p className="text-xs text-green-600">A cliente pode visualizar desde {new Date(result.released_at).toLocaleString('pt-BR')}</p></div>
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
                  <Lock className="h-5 w-5 text-amber-500 flex-shrink-0" />
                  <div><p className="text-sm font-medium text-amber-800">Resultado ainda não liberado</p><p className="text-xs text-amber-600">Preencha abaixo e libere pela aba ✨ IA quando estiver pronto</p></div>
                </div>
              )}

              <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    <FolderOpen className="h-4 w-4 text-violet-500" /> Pasta vinculada
                  </h3>
                  {linkedFolderConfig?.driveLink && (
                    <a
                      href={linkedFolderConfig.driveLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors font-medium"
                    >
                      <ExternalLink className="h-3 w-3" /> Abrir Drive
                    </a>
                  )}
                </div>
                <FolderPicker folders={aiFolders} linkedFolderId={linkedFolderId} onSelect={handleLinkFolder} />
              </div>

              {tagTemplates.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
                  <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Tag className="h-4 w-4 text-emerald-500" /> Informações da análise</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {clientTags.map(tag => {
                      const template = tagTemplates.find(t => t.id === tag.templateId)
                      const options = template?.options || []
                      return (
                        <div key={tag.templateId}>
                          <label className="block text-xs font-medium text-gray-700 mb-1">{tag.name}</label>
                          {options.length > 0 ? (
                            <select value={tag.value} onChange={e => setClientTags(prev => prev.map(t => t.templateId === tag.templateId ? { ...t, value: e.target.value } : t))} className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 ${tag.value ? 'text-gray-800' : 'text-gray-400'}`}>
                              <option value="">— Selecione —</option>
                              {options.map((opt: string, i: number) => <option key={i} value={opt}>{opt}</option>)}
                            </select>
                          ) : (
                            <input value={tag.value} onChange={e => setClientTags(prev => prev.map(t => t.templateId === tag.templateId ? { ...t, value: e.target.value } : t))} placeholder="Digite o valor..." className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
                <h3 className="font-semibold text-gray-900">Observações e arquivos</h3>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Observações</label>
                  <textarea value={resultForm.observations} onChange={e => setResultForm({ ...resultForm, observations: e.target.value })} rows={4} placeholder="Comentários, recomendações, paleta de cores..." className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium text-gray-700">Arquivos PDF</label>
                <Btn variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} loading={uploadingFile}>
                  <Upload className="h-3.5 w-3.5" /> Upload PDF
                </Btn>
                <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleUploadFile} />
              </div>
              {!resultFiles || resultFiles.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center border border-dashed border-gray-200 rounded-lg">Nenhum arquivo adicionado</p>
              ) : (
                <div className="space-y-2">
                  {resultFiles.map((f: any) => (
                    <div key={f.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="h-4 w-4 text-red-500 flex-shrink-0" />
                        <span className="text-sm text-gray-700 truncate">{f.file_name}</span>
                        <span className="text-xs text-gray-400">{(f.file_size / 1024).toFixed(0)} KB</span>
                      </div>
                      <div className="flex items-center gap-2 ml-3">
                        <a href={adminService.getResultFileUrl(f.storage_path)} target="_blank" rel="noopener noreferrer">
                          <Btn variant="ghost" size="sm"><Download className="h-3.5 w-3.5" /></Btn>
                        </a>
                        <Btn variant="ghost" size="sm" onClick={() => handleDeleteFile(f.id, f.storage_path)} className="text-red-500 hover:bg-red-50">
                          <X className="h-3.5 w-3.5" />
                        </Btn>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
              <Btn onClick={async () => { await handleSaveResult(); await handleSaveAIConfig(); await load() }} loading={savingResult || savingAI}>
                <Save className="h-4 w-4" /> Salvar
              </Btn>
              {aiSaveStatus === 'saved' && <span className="text-sm text-green-600 flex items-center gap-1"><CheckCircle className="h-4 w-4" /> Salvo!</span>}
              <span className="text-xs text-gray-400 ml-auto flex items-center gap-1"><Lock className="h-3 w-3" /> Liberação somente na aba ✨ IA</span>
            </div>
          </div>
        </div>
      )}

      {tab === 'ai' && (
        <div className="">
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <AIPromptConfig
              clientId={clientId!}
              clientName={client.full_name}
              isReleased={result?.is_released || false}
              onRelease={handleReleaseResult}
              releasingResult={releasingResult}
              chatEnabled={chatEnabled}
              onChatEnabledChange={setChatEnabled}
              onSaveChatEnabled={handleSaveChatEnabled}
            />
          </div>
        </div>
      )}

      {showFormModal && formSubmission && (
        <FormResponseModal formSubmission={formSubmission} planForm={planForm} onClose={() => setShowFormModal(false)} />
      )}
      <RejectionModal
        open={showRejection}
        clientName={data?.client?.full_name ?? ''}
        hasForm={!!formSubmission}
        hasPhotos={photos.length > 0}
        onCancel={() => setShowRejection(false)}
        onConfirm={handleReject}
      />
      </div>{/* end inner space-y-6 */}
      </div>{/* end overflow-y-auto */}
    </div>
  )
}

// ─── Router ───────────────────────────────────────────────────────────────
export function ClientsManager({ onOpenNav }: { onOpenNav?: () => void }) {
  return (
    <Routes>
      <Route index element={<ClientsList onOpenNav={onOpenNav} />} />
      <Route path=":clientId" element={<ClientDetail onOpenNav={onOpenNav} />} />
    </Routes>
  )
}