// src/components/admin/ClientsManager.tsx
// KanbanBoard integrado com dados reais do Supabase

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Routes, Route, useNavigate, useParams, NavLink } from 'react-router-dom'
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
  SlidersHorizontal, ChevronDown,
} from 'lucide-react'
import { adminService, Client, Plan } from '../../lib/services'
import { supabase } from '../../lib/supabase'
import { formatDeadlineDate, businessDaysUntil } from '../../lib/deadlineCalculator'
import { AIPromptConfig } from './AIPromptConfig'

// ─── Theme System (from KanbanBoard) ──────────────────────────────────────
const THEMES = {
  rose: {
    name: 'Rosa', icon: '🌸',
    bg: '#fff5f7', surface: '#ffffff', surface2: '#fff0f3',
    border: '#fbc8d4', text: '#3d0c17', text2: '#9f4053', text3: '#d4899f',
    colBg: '#fce8ed', cardBg: '#ffffff', cardBorder: '#fbc8d4', cardHover: '#fff5f7',
    accent: '#e91e63', accentFg: '#ffffff', accentLight: '#fce4ec',
    sidebar: '#ffffff',
  },
  light: {
    name: 'Claro', icon: '☀️',
    bg: '#f4f5f7', surface: '#ffffff', surface2: '#f0f1f3',
    border: '#dfe1e6', text: '#172b4d', text2: '#5e6c84', text3: '#97a0af',
    colBg: '#ebecf0', cardBg: '#ffffff', cardBorder: '#dfe1e6', cardHover: '#f4f5f7',
    accent: '#e91e63', accentFg: '#ffffff', accentLight: '#fce4ec',
    sidebar: '#ffffff',
  },
  dark: {
    name: 'Escuro', icon: '🌙',
    bg: '#0d1117', surface: '#161b22', surface2: '#21262d',
    border: '#30363d', text: '#e6edf3', text2: '#8b949e', text3: '#484f58',
    colBg: '#161b22', cardBg: '#21262d', cardBorder: '#30363d', cardHover: '#2d333b',
    accent: '#f78166', accentFg: '#ffffff', accentLight: '#3d1c18',
    sidebar: '#161b22',
  },
  violet: {
    name: 'Violeta', icon: '💜',
    bg: '#f5f3ff', surface: '#ffffff', surface2: '#ede9fe',
    border: '#ddd6fe', text: '#1e0a3c', text2: '#6d28d9', text3: '#a78bfa',
    colBg: '#ede9fe', cardBg: '#ffffff', cardBorder: '#ddd6fe', cardHover: '#f5f3ff',
    accent: '#7c3aed', accentFg: '#ffffff', accentLight: '#ede9fe',
    sidebar: '#ffffff',
  },
  slate: {
    name: 'Grafite', icon: '⚫',
    bg: '#1e293b', surface: '#334155', surface2: '#1e293b',
    border: '#475569', text: '#f1f5f9', text2: '#94a3b8', text3: '#64748b',
    colBg: '#263245', cardBg: '#334155', cardBorder: '#475569', cardHover: '#3f5068',
    accent: '#38bdf8', accentFg: '#0c4a6e', accentLight: '#075985',
    sidebar: '#1e293b',
  },
  mint: {
    name: 'Mint', icon: '🌿',
    bg: '#f0fdf4', surface: '#ffffff', surface2: '#dcfce7',
    border: '#bbf7d0', text: '#052e16', text2: '#166534', text3: '#4ade80',
    colBg: '#dcfce7', cardBg: '#ffffff', cardBorder: '#bbf7d0', cardHover: '#f0fdf4',
    accent: '#16a34a', accentFg: '#ffffff', accentLight: '#dcfce7',
    sidebar: '#ffffff',
  },
}

type ThemeName = keyof typeof THEMES
type Theme = typeof THEMES.rose

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
  in_analysis: {
    label: 'Em Análise', short: 'Análise',
    color: '#f97316', bg: '#ffedd5', textColor: '#9a3412',
    tailwindColor: 'bg-orange-100 text-orange-700', tailwindBg: 'bg-orange-50',
  },
  completed: {
    label: 'Concluído', short: 'Concluído',
    color: '#22c55e', bg: '#dcfce7', textColor: '#166534',
    tailwindColor: 'bg-green-100 text-green-700', tailwindBg: 'bg-green-50',
  },
}
const COL_ORDER = ['awaiting_contract', 'awaiting_form', 'awaiting_photos', 'in_analysis', 'completed']

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
  if (!deadline?.deadline_date || client.status === 'completed') return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dl = new Date(deadline.deadline_date); dl.setHours(0, 0, 0, 0)
  const days = Math.ceil((dl.getTime() - today.getTime()) / 86400000)
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

// ─── Kanban Card (enhanced from KanbanBoard) ──────────────────────────────
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
        border: `1px solid ${dl?.urgency === 'danger' ? '#fca5a5' : dl?.urgency === 'warning' ? '#fcd34d' : t.cardBorder}`,
        borderRadius: 10, padding: compact ? '9px 12px' : '12px 14px',
        marginBottom: 8, cursor: 'pointer', position: 'relative',
        transition: 'box-shadow 0.15s', boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 2px rgba(0,0,0,0.06)' }}
      onClick={onView}
    >
      {/* Top row: avatar + name + menu */}
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
            <p style={{
              margin: '2px 0 0', fontSize: 11, color: t.text2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {(client as any).plan.name}
            </p>
          )}
        </div>

        {/* 3-dot menu */}
        <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
              color: t.text3, borderRadius: 4, display: 'flex', alignItems: 'center', opacity: 0.5,
            }}
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
                <button key={label}
                  onClick={() => { action(); setMenuOpen(false) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '9px 14px', background: 'none', border: 'none',
                    cursor: 'pointer', fontSize: 13, color, textAlign: 'left',
                  }}
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

      {/* Email + deadline (non-compact) */}
      {!compact && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
            <Mail size={11} color={t.text3} />
            <span style={{ fontSize: 11, color: t.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {client.email}
            </span>
          </div>
          {client.phone && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Phone size={11} color={t.text3} />
              <span style={{ fontSize: 11, color: t.text2 }}>{client.phone}</span>
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

// ─── Kanban Column (enhanced from KanbanBoard) ────────────────────────────
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
  const [compact, setCompact] = useState(false)

  if (collapsed) {
    return (
      <div
        onClick={onToggleCollapse}
        title={`Expandir: ${cfg.label}`}
        style={{
          flexShrink: 0, width: 44, background: t.colBg, borderRadius: 12,
          border: `1px solid ${t.border}`, cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: '14px 0', gap: 10,
        }}
      >
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: cfg.color }} />
        <span style={{
          fontSize: 11, fontWeight: 700, color: t.text2,
          writingMode: 'vertical-rl', textOrientation: 'mixed',
          letterSpacing: 1, transform: 'rotate(180deg)', userSelect: 'none',
        }}>
          {cfg.short}
        </span>
        <span style={{
          fontSize: 11, fontWeight: 700, color: t.accent, background: t.accentLight,
          borderRadius: 20, padding: '2px 6px', minWidth: 22, textAlign: 'center',
        }}>
          {clients.length}
        </span>
        {dangerCount > 0 && <span style={{ fontSize: 10, color: '#ef4444' }}>⚠{dangerCount}</span>}
        <ChevronRight size={13} color={t.text3} />
      </div>
    )
  }

  return (
    <div style={{
      flexShrink: 0, width: 'clamp(280px, 22vw, 380px)', background: t.colBg, borderRadius: 12,
      border: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column',
      maxHeight: '100%', overflow: 'hidden',
    }}>
      {/* Column header */}
      <div style={{
        padding: '10px 12px 8px', borderBottom: `1px solid ${t.border}`,
        background: t.colBg, position: 'sticky', top: 0, zIndex: 2,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: t.text, letterSpacing: 0.2 }}>
            {cfg.short}
          </span>
          <span style={{
            fontSize: 11, fontWeight: 700, color: t.accent, background: t.accentLight,
            borderRadius: 20, padding: '1px 7px', minWidth: 22, textAlign: 'center',
          }}>
            {clients.length}
          </span>
          {dangerCount > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', background: '#fee2e2', borderRadius: 20, padding: '1px 6px' }}>
              ⚠{dangerCount}
            </span>
          )}
          <button onClick={() => setCompact(v => !v)} title={compact ? 'Modo normal' : 'Modo compacto'}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: t.text3, opacity: 0.7, borderRadius: 4, display: 'flex' }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.opacity = '1'}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.opacity = '0.7'}
          >
            <Layers size={13} />
          </button>
          <button onClick={onToggleCollapse} title="Recolher coluna"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: t.text3, opacity: 0.7, borderRadius: 4, display: 'flex' }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.opacity = '1'}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.opacity = '0.7'}
          >
            <ChevronLeft size={14} />
          </button>
        </div>
      </div>

      {/* Cards list (scrollable) */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px', paddingBottom: 6 }}>
        {clients.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 12px', color: t.text3 }}>
            <p style={{ fontSize: 12, margin: 0 }}>Nenhuma cliente</p>
          </div>
        ) : (
          clients.map(client => (
            <KanbanCard
              key={client.id}
              client={client}
              deadline={deadlines[client.id] || null}
              theme={t}
              compact={compact}
              starred={starredIds.has(client.id)}
              onView={() => onView(client.id)}
              onArchive={() => onArchive(client.id)}
              onDelete={() => onDelete(client.id)}
              onStar={() => onStar(client.id)}
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
    <div style={{
      position: 'relative',
      width: sidebarOpen ? 220 : 0, flexShrink: 0, background: t.sidebar,
      borderRight: sidebarOpen ? `1px solid ${t.border}` : 'none', overflow: 'hidden',
      transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ width: 220, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Search */}
        <div style={{ padding: '12px 12px 8px' }}>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: t.text3 }} />
            <input
              value={search}
              onChange={e => onSearch(e.target.value)}
              placeholder="Buscar cliente..."
              style={{
                width: '100%', padding: '7px 10px 7px 30px', borderRadius: 8,
                border: `1px solid ${t.border}`, background: t.surface2,
                fontSize: 12, color: t.text, outline: 'none', boxSizing: 'border-box' as const,
              }}
            />
          </div>
        </div>

        {/* Navigation */}
        <div style={{ padding: '4px 8px', flex: 1, overflowY: 'auto' }}>
          {navBtn('all', 'Todas as clientes', total)}
          {navBtn('danger', 'Prazo crítico', dangerCount, '#ef4444', <AlertTriangle size={14} />)}

          <div style={{ borderTop: `1px solid ${t.border}`, margin: '8px 0', padding: '8px 0 4px' }}>
            <p style={{ margin: '0 0 4px 10px', fontSize: 10, fontWeight: 700, color: t.text3, textTransform: 'uppercase' as const, letterSpacing: 1 }}>
              Por status
            </p>
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
        <span style={{ fontSize: 12, color: t.text3, background: t.surface2, padding: '2px 8px', borderRadius: 20 }}>
          {clients.length}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px,1fr))', gap: 12 }}>
        {clients.map(client => {
          const [bg, fg] = getAvatarColor(client.full_name)
          const cfg = STATUSES[client.status]
          return (
            <div key={client.id} style={{
              background: t.cardBg, border: `1px solid ${t.border}`,
              borderRadius: 12, padding: '14px 16px', opacity: 0.8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: bg, color: fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>
                  {getInitials(client.full_name)}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: t.text }}>{client.full_name}</p>
                  <p style={{ margin: 0, fontSize: 11, color: t.text2 }}>{(client as any).plan?.name}</p>
                </div>
                <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, background: cfg.bg, color: cfg.textColor, fontWeight: 600 }}>
                  {cfg.short}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => onRestore(client.id)}
                  style={{ flex: 1, padding: 6, borderRadius: 8, border: `1px solid ${t.border}`, background: 'none', cursor: 'pointer', fontSize: 12, color: t.text2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = t.surface2}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'none'}
                >
                  <ArchiveRestore size={13} /> Restaurar
                </button>
                <button onClick={() => onDelete(client.id)}
                  style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #fca5a5', background: 'none', cursor: 'pointer', fontSize: 12, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 6 }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#fee2e2'}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'none'}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Clients List (Board + List) ──────────────────────────────────────────
function ClientsList() {
  // Real data
  const [clients, setClients] = useState<Client[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [deadlines, setDeadlines] = useState<Record<string, DeadlineData>>({})
  const [loading, setLoading] = useState(true)

  // KanbanBoard UI state
  const [themeName, setThemeName] = useState<ThemeName>('rose')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set())
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board')

  // Create form
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', birth_date: '', plan_id: '', notes: '' })

  // Theme picker dropdown
  const [themeOpen, setThemeOpen] = useState(false)
  const themeRef = useRef<HTMLDivElement>(null)

  const t = THEMES[themeName]
  const navigate = useNavigate()

  useEffect(() => { load() }, [])

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (themeRef.current && !themeRef.current.contains(e.target as Node)) setThemeOpen(false)
    }
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

  // Archive / star / delete handlers
  const handleArchive = useCallback((id: string) =>
    setArchivedIds(prev => new Set([...prev, id])), [])

  const handleRestore = useCallback((id: string) =>
    setArchivedIds(prev => { const s = new Set(prev); s.delete(id); return s }), [])

  const handleStar = useCallback((id: string) =>
    setStarredIds(prev => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id); else s.add(id)
      return s
    }), [])

  const handleDelete = async (id: string) => {
    const client = clients.find(c => c.id === id)
    if (!client) return
    if (!confirm(`Excluir "${client.full_name}"? Todos os dados e arquivos serão removidos.`)) return
    await adminService.deleteClient(id)
    load()
  }

  const toggleCollapse = useCallback((key: string) =>
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] })), [])

  // Derived lists
  const activeClients = useMemo(() => clients.filter(c => !archivedIds.has(c.id)), [clients, archivedIds])
  const archivedClients = useMemo(() => clients.filter(c => archivedIds.has(c.id)), [clients, archivedIds])

  const filteredActive = useMemo(() => {
    let list = activeClients
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        c.full_name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.phone && c.phone.toLowerCase().includes(q))
      )
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
    background: active ? t.surface : 'none',
    border: 'none', cursor: 'pointer', padding: '5px 8px', borderRadius: 6,
    color: active ? t.text : t.text2, display: 'flex', alignItems: 'center', gap: 5,
    fontSize: 13, fontWeight: active ? 600 : 400,
    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
  })

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0', background: t.bg }}>
      <div className="animate-spin h-8 w-8 border-2 border-rose-400 border-t-transparent rounded-full" />
    </div>
  )

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      display: 'flex', flexDirection: 'column',
      height: '100vh', width: '100vw',
      background: t.bg,
      fontFamily: 'system-ui,-apple-system,sans-serif',
      overflow: 'hidden',
    }}>
      {/* ── Toolbar ──────────────────────────────────────────── */}
      <div style={{
        background: t.surface, borderBottom: `1px solid ${t.border}`,
        padding: '0 16px', display: 'flex', alignItems: 'center', gap: 6,
        flexShrink: 0, height: 48,
      }}>
        {/* App nav links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginRight: 8, flexShrink: 0 }}>
          {[
            { to: '/admin/clients', label: 'Clientes' },
            { to: '/admin/plans', label: 'Planos' },
            { to: '/admin/folders', label: 'Pastas IA' },
            { to: '/admin/settings', label: 'Config.' },
          ].map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              style={({ isActive }) => ({
                padding: '5px 10px', borderRadius: 6, fontSize: 12, fontWeight: isActive ? 700 : 500,
                color: isActive ? t.accent : t.text2,
                background: isActive ? t.accentLight : 'none',
                textDecoration: 'none', whiteSpace: 'nowrap' as const,
                transition: 'background 0.15s, color 0.15s',
              })}
            >
              {label}
            </NavLink>
          ))}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 20, background: t.border, flexShrink: 0, marginRight: 6 }} />

        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarOpen(v => !v)}
          title={sidebarOpen ? 'Fechar menu' : 'Abrir menu'}
          style={{ background: sidebarOpen ? t.surface2 : 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: sidebarOpen ? t.accent : t.text2, display: 'flex', flexShrink: 0 }}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = t.surface2}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = sidebarOpen ? t.surface2 : 'none'}
        >
          <SlidersHorizontal size={16} />
        </button>

        {/* Title */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: t.text }}>Clientes</span>
          <span style={{ fontSize: 12, color: t.text3, marginLeft: 8 }}>
            {activeClients.length} ativa{activeClients.length !== 1 ? 's' : ''}
            {filteredActive.length !== activeClients.length && !isArchiveView &&
              <span style={{ color: t.accent, marginLeft: 4 }}>· {filteredActive.length} filtrada{filteredActive.length !== 1 ? 's' : ''}</span>
            }
          </span>
        </div>

        {/* Status mini-stats (board view only) */}
        {!isArchiveView && viewMode === 'board' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            {COL_ORDER.map(key => {
              const cfg = STATUSES[key]
              const count = groupedByStatus[key]?.length || 0
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: t.text2 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.color }} />
                  <span style={{ fontWeight: count > 0 ? 600 : 400, color: count > 0 ? t.text : t.text3 }}>{count}</span>
                </div>
              )
            })}
          </div>
        )}

        {/* Theme picker */}
        <div ref={themeRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setThemeOpen(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px',
              borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface2,
              cursor: 'pointer', fontSize: 12, color: t.text2,
            }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = t.surface}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = t.surface2}
          >
            <span style={{ fontSize: 14 }}>{THEMES[themeName].icon}</span>
            <ChevronDown size={12} />
          </button>
          {themeOpen && (
            <div style={{
              position: 'absolute', right: 0, top: 36, background: t.surface,
              border: `1px solid ${t.border}`, borderRadius: 10,
              boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 200, overflow: 'hidden', minWidth: 140,
            }}>
              <div style={{ padding: '8px 12px 4px' }}>
                <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: t.text3, textTransform: 'uppercase' as const, letterSpacing: 1 }}>Tema</p>
              </div>
              {(Object.entries(THEMES) as [ThemeName, Theme][]).map(([key, th]) => (
                <button key={key} onClick={() => { setThemeName(key); setThemeOpen(false) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9, width: '100%',
                    padding: '9px 14px', background: themeName === key ? t.accentLight : 'none',
                    border: 'none', cursor: 'pointer', fontSize: 13,
                    color: themeName === key ? t.accent : t.text, textAlign: 'left',
                    fontWeight: themeName === key ? 600 : 400,
                  }}
                  onMouseEnter={e => { if (themeName !== key) (e.currentTarget as HTMLButtonElement).style.background = t.surface2 }}
                  onMouseLeave={e => { if (themeName !== key) (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
                >
                  <span style={{ fontSize: 15 }}>{th.icon}</span> {th.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* View toggle */}
        <div style={{ display: 'flex', background: t.surface2, borderRadius: 8, padding: 2, flexShrink: 0 }}>
          <button onClick={() => setViewMode('board')} title="Kanban" style={btnStyle(viewMode === 'board')}>
            <LayoutGrid size={15} />
          </button>
          <button onClick={() => setViewMode('list')} title="Lista" style={btnStyle(viewMode === 'list')}>
            <List size={15} />
          </button>
        </div>
      </div>

      {/* ── Body: Sidebar + Main ──────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <KanbanSidebar
          theme={t} clients={activeClients} search={search} onSearch={setSearch}
          filter={filter} onFilter={setFilter} sidebarOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(v => !v)}
          total={activeClients.length} archivedCount={archivedClients.length}
          deadlines={deadlines}
        />

        {/* Main area */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

          {/* ── Archive view ─────────────────────────────── */}
          {isArchiveView && (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <ArchiveView
                clients={archivedClients} theme={t}
                onRestore={handleRestore} onDelete={handleDelete}
              />
            </div>
          )}

          {/* ── Board view ────────────────────────────────── */}
          {!isArchiveView && viewMode === 'board' && (
            <>
              {filteredActive.length === 0 && !search && filter === 'all' ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, color: t.text3 }}>
                  <User size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
                  <p style={{ fontSize: 14, margin: 0, color: t.text2 }}>Nenhuma cliente cadastrada ainda</p>
                  <p style={{ fontSize: 12, margin: '4px 0 0', color: t.text3 }}>As clientes aparecerão aqui após o cadastro</p>
                </div>
              ) : (
                <div style={{
                  flex: 1, overflowX: 'auto', overflowY: 'hidden',
                  padding: '16px 20px 20px', display: 'flex', gap: 14, alignItems: 'flex-start',
                }}>
                  {COL_ORDER.map(key => (
                    <KanbanColumn
                      key={key}
                      statusKey={key}
                      clients={groupedByStatus[key] || []}
                      deadlines={deadlines}
                      starredIds={starredIds}
                      theme={t}
                      collapsed={!!collapsed[key]}
                      onToggleCollapse={() => toggleCollapse(key)}
                      onView={id => navigate(`/admin/clients/${id}`)}
                      onArchive={handleArchive}
                      onDelete={handleDelete}
                      onStar={handleStar}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── List view ─────────────────────────────────── */}
          {!isArchiveView && viewMode === 'list' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {filteredActive.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, color: t.text3 }}>
                  <User size={36} style={{ marginBottom: 10, opacity: 0.4 }} />
                  <p style={{ fontSize: 14, margin: 0, color: t.text2 }}>
                    {search || filter !== 'all' ? 'Nenhuma cliente encontrada' : 'Nenhuma cliente cadastrada'}
                  </p>
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
                        style={{
                          background: t.cardBg, border: `1px solid ${dl?.urgency === 'danger' ? '#fca5a5' : t.cardBorder}`,
                          borderRadius: 12, padding: '12px 16px', display: 'flex',
                          alignItems: 'center', justifyContent: 'space-between', gap: 12,
                          cursor: 'pointer',
                        }}
                        onClick={() => navigate(`/admin/clients/${client.id}`)}
                        onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = t.accent + '60'}
                        onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = dl?.urgency === 'danger' ? '#fca5a5' : t.cardBorder}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                          {/* Avatar */}
                          <div style={{
                            width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                            background: getAvatarColor(client.full_name)[0],
                            color: getAvatarColor(client.full_name)[1],
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 13, fontWeight: 700,
                          }}>
                            {getInitials(client.full_name)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
                              <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{client.full_name}</span>
                              <span style={{
                                fontSize: 10, padding: '2px 8px', borderRadius: 20,
                                background: cfg.bg, color: cfg.textColor, fontWeight: 600,
                              }}>
                                {cfg.label}
                              </span>
                              {starredIds.has(client.id) && <span style={{ fontSize: 11, color: '#f59e0b' }}>★</span>}
                              {dl && (
                                <span style={{
                                  fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 600,
                                  background: dl.urgency === 'danger' ? '#fee2e2' : '#fef3c7',
                                  color: dl.urgency === 'danger' ? '#991b1b' : '#92400e',
                                }}>
                                  📅 {dl.label}
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 3 }}>
                              <span style={{ fontSize: 12, color: t.text2, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Mail size={11} color={t.text3} /> {client.email}
                              </span>
                              {client.phone && (
                                <span style={{ fontSize: 12, color: t.text2, display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <Phone size={11} color={t.text3} /> {client.phone}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
                          onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => handleStar(client.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: starredIds.has(client.id) ? '#f59e0b' : t.text3 }}
                            title={starredIds.has(client.id) ? 'Remover estrela' : 'Destacar'}
                          >
                            <Star size={15} />
                          </button>
                          <button
                            onClick={() => navigate(`/admin/clients/${client.id}`)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px',
                              borderRadius: 8, border: `1px solid ${t.border}`, background: 'none',
                              cursor: 'pointer', fontSize: 12, color: t.text2,
                            }}
                            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = t.surface2}
                            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'none'}
                          >
                            <Eye size={13} /> Ver
                          </button>
                          <button
                            onClick={() => handleArchive(client.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: t.text3 }}
                            title="Arquivar"
                          >
                            <Archive size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(client.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: '#ef4444' }}
                            title="Excluir"
                          >
                            <Trash2 size={14} />
                          </button>
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
  const fields: any[] = planForm?.fields || []
  const fieldMap = Object.fromEntries(fields.map((f: any) => [f.id, f]))
  const getLabel = (key: string) => fieldMap[key]?.label || key
  const getValue = (value: any) => {
    if (value === null || value === undefined || value === '') return '—'
    if (Array.isArray(value)) return value.join(', ')
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  const handleDownloadPDF = () => {
    const win = window.open('', '_blank')
    if (!win) return
    const rows = Object.entries(formData).map(([key, value]) => `
      <tr>
        <td style="padding:8px 12px;font-weight:600;color:#555;background:#f9f9f9;border:1px solid #eee;width:35%">${getLabel(key)}</td>
        <td style="padding:8px 12px;border:1px solid #eee">${getValue(value)}</td>
      </tr>
    `).join('')
    win.document.write(`
      <html><head><title>Formulário</title>
      <style>body{font-family:Arial,sans-serif;padding:32px}h1{font-size:18px;margin-bottom:4px}p{color:#888;font-size:13px;margin-bottom:20px}table{width:100%;border-collapse:collapse}</style>
      </head><body>
      <h1>Respostas do Formulário</h1>
      <p>Enviado em: ${formSubmission?.submitted_at ? new Date(formSubmission.submitted_at).toLocaleString('pt-BR') : '—'}</p>
      <table>${rows}</table>
      </body></html>
    `)
    win.document.close()
    win.print()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center">
              <ClipboardList className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Respostas do Formulário</h2>
              {formSubmission?.submitted_at && (
                <p className="text-xs text-gray-400">Enviado em {new Date(formSubmission.submitted_at).toLocaleString('pt-BR')}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Btn variant="outline" size="sm" onClick={handleDownloadPDF}>
              <Download className="h-3.5 w-3.5" /> Baixar PDF
            </Btn>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-1"><X className="h-5 w-5" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {Object.entries(formData).length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Sem respostas</p>
          ) : (
            Object.entries(formData).map(([key, value]: any) => {
              const field = fieldMap[key]
              const isImage = field?.type === 'image'
              return (
                <div key={key} className="border-b border-gray-50 pb-4 last:border-0">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{getLabel(key)}</p>
                  {isImage && typeof value === 'string' && value.startsWith('http') ? (
                    <a href={value} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700">
                      <Image className="h-4 w-4" /> Ver imagem anexada
                    </a>
                  ) : (
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{getValue(value)}</p>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Photo Lightbox ───────────────────────────────────────────────────────
function PhotoLightbox({ photos, initialIndex, onClose }: {
  photos: any[]; initialIndex: number; onClose: () => void
}) {
  const [index, setIndex] = useState(initialIndex)
  const [zoom, setZoom] = useState(1)
  const prev = useCallback(() => { setIndex(i => (i - 1 + photos.length) % photos.length); setZoom(1) }, [photos.length])
  const next = useCallback(() => { setIndex(i => (i + 1) % photos.length); setZoom(1) }, [photos.length])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
      if (e.key === '+' || e.key === '=') setZoom(z => Math.min(z + 0.5, 4))
      if (e.key === '-') setZoom(z => Math.max(z - 0.5, 0.5))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [prev, next, onClose])

  const photo = photos[index]
  const handleDownload = () => {
    const a = document.createElement('a'); a.href = photo.url; a.download = photo.photo_name; a.target = '_blank'; a.click()
  }

  return (
    <div className="fixed inset-0 bg-black/95 z-50 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between px-4 py-3 bg-black/40 flex-shrink-0" onClick={e => e.stopPropagation()}>
        <p className="text-white text-sm font-medium truncate max-w-xs">{photo.photo_name}</p>
        <div className="flex items-center gap-2">
          <button onClick={() => setZoom(z => Math.max(z - 0.5, 0.5))} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg"><ZoomOut className="h-4 w-4" /></button>
          <span className="text-white/70 text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(z + 0.5, 4))} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg"><ZoomIn className="h-4 w-4" /></button>
          <button onClick={handleDownload} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg"><Download className="h-4 w-4" /></button>
          <span className="text-white/40 text-xs">{index + 1}/{photos.length}</span>
          <button onClick={onClose} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg ml-1"><X className="h-5 w-5" /></button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center overflow-hidden relative" onClick={e => e.stopPropagation()}>
        {photos.length > 1 && (
          <button onClick={prev} className="absolute left-4 z-10 p-3 bg-black/50 hover:bg-black/70 rounded-full text-white"><ChevronLeft className="h-6 w-6" /></button>
        )}
        <img src={photo.url} alt={photo.photo_name} className="max-w-full max-h-full object-contain select-none transition-transform duration-200"
          style={{ transform: `scale(${zoom})`, cursor: zoom > 1 ? 'move' : 'default' }} draggable={false} />
        {photos.length > 1 && (
          <button onClick={next} className="absolute right-4 z-10 p-3 bg-black/50 hover:bg-black/70 rounded-full text-white"><ChevronRight className="h-6 w-6" /></button>
        )}
      </div>
      {photos.length > 1 && (
        <div className="flex-shrink-0 bg-black/60 py-3 px-4" onClick={e => e.stopPropagation()}>
          <div className="flex gap-2 justify-center overflow-x-auto pb-1">
            {photos.map((p, i) => (
              <button key={p.id} onClick={() => { setIndex(i); setZoom(1) }}
                className={`flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden transition-all ${i === index ? 'ring-2 ring-rose-400 opacity-100' : 'opacity-50 hover:opacity-80'}`}>
                <img src={p.url} alt={p.photo_name} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Photos View ──────────────────────────────────────────────────────────
function PhotosView({ clientId, photos, photoCategories }: {
  clientId: string; photos: any[]; photoCategories: any[]
}) {
  const [photosWithUrls, setPhotosWithUrls] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [lightbox, setLightbox] = useState<{ photos: any[]; index: number } | null>(null)

  useEffect(() => {
    adminService.getClientPhotosWithUrls(clientId).then(p => { setPhotosWithUrls(p); setLoading(false) })
  }, [clientId])

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-rose-400 border-t-transparent rounded-full" /></div>
  if (photosWithUrls.length === 0) return (
    <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center">
      <Camera className="h-10 w-10 text-gray-300 mx-auto mb-3" />
      <p className="text-gray-500">Nenhuma foto enviada ainda</p>
    </div>
  )

  const photosByCat: Record<string, any[]> = {}
  const uncategorized: any[] = []
  photosWithUrls.forEach(p => {
    if (p.category_id) { if (!photosByCat[p.category_id]) photosByCat[p.category_id] = []; photosByCat[p.category_id].push(p) }
    else uncategorized.push(p)
  })

  const downloadAll = (catPhotos: any[]) => {
    catPhotos.forEach((p, i) => {
      setTimeout(() => {
        const a = document.createElement('a'); a.href = p.url; a.download = p.photo_name; a.target = '_blank'
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
      }, i * 300)
    })
  }

  const renderGrid = (catPhotos: any[]) => (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {catPhotos.map((photo, idx) => (
        <div key={photo.id} className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 cursor-pointer group hover:ring-2 hover:ring-rose-400 transition-all"
          onClick={() => setLightbox({ photos: catPhotos, index: idx })}>
          <img src={photo.url} alt={photo.photo_name} className="w-full h-full object-cover" loading="lazy" />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
            <Maximize2 className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <>
      <div className="space-y-5">
        {photoCategories.map(cat => {
          const catPhotos = photosByCat[cat.id] || []
          if (catPhotos.length === 0) return null
          return (
            <div key={cat.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div><h3 className="font-semibold text-gray-900">{cat.title}</h3><p className="text-xs text-gray-400 mt-0.5">{catPhotos.length} foto{catPhotos.length !== 1 ? 's' : ''}</p></div>
                <Btn variant="outline" size="sm" onClick={() => downloadAll(catPhotos)}><Download className="h-3.5 w-3.5" /> Baixar todas</Btn>
              </div>
              <div className="p-5">{renderGrid(catPhotos)}</div>
            </div>
          )
        })}
        {uncategorized.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div><h3 className="font-semibold text-gray-900">Fotos sem categoria</h3><p className="text-xs text-gray-400 mt-0.5">{uncategorized.length} foto{uncategorized.length !== 1 ? 's' : ''}</p></div>
              <Btn variant="outline" size="sm" onClick={() => downloadAll(uncategorized)}><Download className="h-3.5 w-3.5" /> Baixar todas</Btn>
            </div>
            <div className="p-5">{renderGrid(uncategorized)}</div>
          </div>
        )}
      </div>
      {lightbox && <PhotoLightbox photos={lightbox.photos} initialIndex={lightbox.index} onClose={() => setLightbox(null)} />}
    </>
  )
}

// ─── Client Detail ────────────────────────────────────────────────────────
// (Mantido exatamente como estava — toda a lógica de tabs, resultado, IA, etc.)
function ClientDetail() {
  const { clientId } = useParams<{ clientId: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
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

  const [editingDeadline, setEditingDeadline] = useState(false)
  const [deadlineInput, setDeadlineInput] = useState('')
  const [savingDeadline, setSavingDeadline] = useState(false)

  useEffect(() => { load() }, [clientId])

  const buildSystemPrompt = (name: string, folderConfig: any, tags: { name: string; value: string }[]): string => {
    const filled = tags.filter(t => t.value.trim())
    let tagSection = ''
    if (filled.length > 0) {
      tagSection = `\n═══ INFORMAÇÕES DA ANÁLISE DESTA CLIENTE ═══\n${filled.map(t => `${t.name}: ${t.value}`).join('\n')}\n\nUse ESTAS informações como base para TODAS as respostas.`
    }
    if (!folderConfig && !filled.length) return ''
    let categoriesSection = ''
    if (folderConfig) {
      const catLines = (folderConfig.categories || []).map((cat: any) => {
        const prompts = (cat.prompts || []).map((p: any) => {
          let d = '  - ' + p.name
          if (p.options?.length) d += ' [' + p.options.join(', ') + ']'
          if (p.instructions) d += ' → ' + p.instructions
          return d
        }).join('\n')
        return '📌 ' + cat.name + ':\n' + (prompts || '  (vazio)')
      }).join('\n\n')
      categoriesSection = '\n═══ CATEGORIAS ═══\n' + catLines
    }
    const parts: string[] = [
      'Você é a "MS Color IA", assistente virtual de coloração pessoal.',
      'Atende a cliente ' + name + '.', '',
      '═══ REGRAS ABSOLUTAS ═══',
      '1. FOTO: Já está anexada. NUNCA peça foto.',
      '2. ROSTO: Mantenha feições idênticas ao gerar imagens.',
      '3. RESPOSTAS: Baseie-se EXCLUSIVAMENTE nas informações abaixo.',
      '4. ESCOPO: Só coloração pessoal, moda, estilo, cabelo, maquiagem, acessórios.',
      '5. TOM: Entusiasmada, positiva. Português brasileiro.',
      tagSection, categoriesSection,
      '═══ GERAÇÃO ═══', '- Use a foto da categoria correta (cabelo/roupa/geral) como base.',
    ]
    return parts.join('\n')
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
    const folders = foldersRes.data || []
    setAiFolders(folders)
    const tpls = (templatesRes.data || []).map((t: any) => ({ ...t, options: Array.isArray(t.options) ? t.options : [] }))
    setTagTemplates(tpls)
    const folderId = detail.client.ai_folder_id || null
    setLinkedFolderId(folderId)
    if (folderId) {
      const fc = folders.find((f: any) => f.id === folderId)
      setLinkedFolderConfig(fc ? (typeof fc.config === 'string' ? JSON.parse(fc.config) : fc.config) : null)
    }
    const savedTags: any[] = detail.client.ai_info_tags || []
    setClientTags(tpls.map((t: any) => {
      const saved = savedTags.find((s: any) => s.templateId === t.id)
      return { templateId: t.id, name: t.name, value: saved?.value || '' }
    }))
    setLoading(false)
  }

  const handleSaveNotes = async () => {
    setSavingNotes(true)
    try { await adminService.updateClient(clientId!, { notes } as any); setNotesSaved(true); setTimeout(() => setNotesSaved(false), 2000) }
    catch (e: any) { alert(e.message) } finally { setSavingNotes(false) }
  }

  const handleSaveDeadline = async () => {
    if (!deadlineInput) return
    setSavingDeadline(true)
    try {
      await supabase.from('client_deadlines').update({ deadline_date: deadlineInput }).eq('client_id', clientId!)
      setEditingDeadline(false); load()
    } catch (e: any) { alert(e.message) } finally { setSavingDeadline(false) }
  }

  const copyLink = () => {
    const link = `${window.location.origin}/c/${data.client.token}`
    navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  const handleSaveResult = async () => {
    setSavingResult(true)
    try { await adminService.saveResult(clientId!, resultForm); load() }
    catch (e: any) { alert(e.message) } finally { setSavingResult(false) }
  }

  const handleReleaseResult = async () => {
    const hasContent = resultForm.observations.trim() || resultFiles?.length > 0 || linkedFolderId
    if (!hasContent) { if (!confirm('⚠️ Nenhum conteúdo adicionado.\n\nDeseja liberar mesmo assim?')) return }
    else { if (!confirm('Liberar o resultado para a cliente?')) return }
    setReleasingResult(true)
    try { await adminService.releaseResult(clientId!); load() }
    catch (e: any) { alert(e.message) } finally { setReleasingResult(false) }
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

  const handleLinkFolder = async (folderId: string | null) => {
    setLinkedFolderId(folderId)
    if (folderId) {
      const fc = aiFolders.find((f: any) => f.id === folderId)
      const config = fc ? (typeof fc.config === 'string' ? JSON.parse(fc.config) : fc.config) : null
      setLinkedFolderConfig(config)
    } else { setLinkedFolderConfig(null) }
  }

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setUploadingFile(true)
    try { await adminService.uploadResultFile(clientId!, file); load() }
    catch (e: any) { alert(e.message) } finally { setUploadingFile(false); if (fileInputRef.current) fileInputRef.current.value = '' }
  }

  const handleDeleteFile = async (fileId: string, storagePath: string) => {
    if (!confirm('Remover este arquivo?')) return
    await adminService.deleteResultFile(fileId, storagePath); load()
  }

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin h-8 w-8 border-2 border-rose-400 border-t-transparent rounded-full" /></div>
  if (!data) return <div className="text-center py-20 text-gray-500">Cliente não encontrado</div>

  const { client, contract, formSubmission, photos, deadline, result, resultFiles, photoCategories, planForm } = data
  const status = STATUSES[client.status]
  const portalLink = `${window.location.origin}/c/${client.token}`

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/admin/clients')} className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="w-12 h-12 bg-gradient-to-br from-rose-100 to-pink-100 rounded-full flex items-center justify-center">
            <span className="text-rose-600 font-bold text-lg">{client.full_name[0].toUpperCase()}</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900">{client.full_name}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium`}
                style={{ background: status?.bg, color: status?.textColor }}>
                {status?.label}
              </span>
            </div>
            <div className="flex items-center gap-3 text-sm text-gray-500 mt-0.5">
              <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{client.email}</span>
              {client.phone && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{client.phone}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Btn variant="outline" size="sm" onClick={copyLink}>
            {copied ? <><Check className="h-3.5 w-3.5" /> Copiado!</> : <><FileText className="h-3.5 w-3.5" /> Copiar Link</>}
          </Btn>
          <a href={portalLink} target="_blank" rel="noopener noreferrer">
            <Btn variant="ghost" size="sm"><ExternalLink className="h-3.5 w-3.5" /> Abrir Portal</Btn>
          </a>
        </div>
      </div>

      {/* Portal link */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500 mb-0.5">Link de acesso do cliente</p>
          <p className="text-sm font-mono text-gray-700 truncate">{portalLink}</p>
        </div>
        <Btn variant="outline" size="sm" onClick={copyLink}><Copy className="h-3.5 w-3.5" /></Btn>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit flex-wrap">
        {[
          { id: 'overview', label: 'Visão Geral' },
          { id: 'photos', label: `Fotos (${photos.length})` },
          { id: 'result', label: 'Resultado' },
          { id: 'ai', label: '✨ IA' },
        ].map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id as any)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Progresso</h3>
            <div className="space-y-3">
              {[
                { label: 'Contrato assinado', done: !!contract, date: contract?.signed_at },
                { label: 'Formulário enviado', done: !!formSubmission, date: formSubmission?.submitted_at },
                { label: `Fotos enviadas (${photos.length})`, done: photos.length > 0 && client.status !== 'awaiting_photos' },
                { label: 'Em análise', done: ['in_analysis', 'completed'].includes(client.status) },
                { label: 'Resultado liberado', done: result?.is_released },
              ].map(({ label, done, date }: any) => (
                <div key={label} className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${done ? 'bg-green-100' : 'bg-gray-100'}`}>
                    {done ? <Check className="h-3.5 w-3.5 text-green-600" /> : <div className="w-2 h-2 rounded-full bg-gray-300" />}
                  </div>
                  <div className="flex-1">
                    <span className={`text-sm ${done ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>{label}</span>
                    {date && <span className="text-xs text-gray-400 ml-2">{new Date(date).toLocaleDateString('pt-BR')}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Prazo</h3>
              {deadline && !editingDeadline && (
                <Btn variant="outline" size="sm" onClick={() => { setDeadlineInput(deadline.deadline_date); setEditingDeadline(true) }}>
                  <Calendar className="h-3.5 w-3.5" /> Editar
                </Btn>
              )}
            </div>
            {deadline ? (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Fotos enviadas em</p>
                  <p className="text-sm font-medium text-gray-800">{new Date(deadline.photos_sent_at).toLocaleString('pt-BR')}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Prazo de entrega</p>
                  {editingDeadline ? (
                    <div className="space-y-2">
                      <input type="date" value={deadlineInput} onChange={e => setDeadlineInput(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
                      <div className="flex gap-2">
                        <Btn size="sm" onClick={handleSaveDeadline} loading={savingDeadline}><Check className="h-3.5 w-3.5" /> Salvar</Btn>
                        <Btn variant="outline" size="sm" onClick={() => setEditingDeadline(false)}>Cancelar</Btn>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-gray-800">{formatDeadlineDate(new Date(deadline.deadline_date))}</p>
                      {client.status !== 'completed' && (
                        <p className="text-xs text-orange-600 mt-0.5">{businessDaysUntil(new Date(deadline.deadline_date))} dias úteis restantes</p>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : <p className="text-sm text-gray-400">Prazo calculado após envio das fotos</p>}
          </div>

          {client.plan && (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="font-semibold text-gray-900 mb-2">Plano</h3>
              <p className="text-sm text-gray-700">{(client as any).plan.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">{(client as any).plan.deadline_days} dias úteis</p>
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-gray-400" /> Observações Internas
              </h3>
              <Btn variant={notesSaved ? 'green' : 'outline'} size="sm" onClick={handleSaveNotes}
                loading={savingNotes} disabled={notes === (client.notes || '')}>
                {notesSaved ? <><Check className="h-3.5 w-3.5" /> Salvo</> : <><Save className="h-3.5 w-3.5" /> Salvar</>}
              </Btn>
            </div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder="Anotações internas (não visível para a cliente)..."
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none bg-gray-50 focus:bg-white transition-colors" />
            {notes !== (client.notes || '') && (
              <p className="text-xs text-amber-500 mt-1.5 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Alterações não salvas</p>
            )}
          </div>

          <div className={`border rounded-xl p-5 md:col-span-2 ${formSubmission ? 'bg-white border-gray-200' : 'bg-gray-50 border-dashed border-gray-300'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${formSubmission ? 'bg-blue-50' : 'bg-gray-100'}`}>
                  <ClipboardList className={`h-5 w-5 ${formSubmission ? 'text-blue-500' : 'text-gray-400'}`} />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Formulário</h3>
                  {formSubmission
                    ? <p className="text-xs text-gray-400">Enviado em {new Date(formSubmission.submitted_at).toLocaleDateString('pt-BR')}</p>
                    : <p className="text-xs text-gray-400">Aguardando envio do cliente</p>}
                </div>
              </div>
              {formSubmission && (
                <Btn variant="outline" size="sm" onClick={() => setShowFormModal(true)}>
                  <Eye className="h-3.5 w-3.5" /> Ver Respostas
                </Btn>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'photos' && <PhotosView clientId={clientId!} photos={photos} photoCategories={photoCategories} />}

      {tab === 'result' && (
        <div className="space-y-5 max-w-3xl">
          {result?.is_released ? (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-green-800">Resultado liberado</p>
                <p className="text-xs text-green-600">A cliente pode visualizar desde {new Date(result.released_at).toLocaleString('pt-BR')}</p>
              </div>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
              <Lock className="h-5 w-5 text-amber-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-800">Resultado ainda não liberado</p>
                <p className="text-xs text-amber-600">Preencha abaixo e libere pela aba ✨ IA quando estiver pronto</p>
              </div>
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><FolderOpen className="h-4 w-4 text-violet-500" /> Pasta vinculada</h3>
            <p className="text-xs text-gray-500 -mt-2">Selecione a pasta criada em Pastas IA</p>
            <div className="space-y-2">
              <button onClick={() => handleLinkFolder(null)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left ${linkedFolderId === null ? 'bg-gray-100 border-gray-300' : 'bg-white border-gray-200 hover:border-gray-300'}`}>
                <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0"><FolderOpen className="h-4 w-4 text-gray-400" /></div>
                <span className="text-sm text-gray-500">Nenhuma pasta vinculada</span>
                {linkedFolderId === null && <CheckCircle className="h-4 w-4 text-gray-400 ml-auto" />}
              </button>
              {aiFolders.map((f: any) => {
                const cfg = typeof f.config === 'string' ? JSON.parse(f.config) : f.config
                const isLinked = linkedFolderId === f.id
                return (
                  <button key={f.id} onClick={() => handleLinkFolder(f.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left ${isLinked ? 'bg-violet-50 border-violet-300' : 'bg-white border-gray-200 hover:border-violet-200'}`}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isLinked ? 'bg-violet-100' : 'bg-gray-50'}`}>
                      <FolderOpen className={`h-4 w-4 ${isLinked ? 'text-violet-600' : 'text-gray-400'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${isLinked ? 'text-violet-800' : 'text-gray-800'}`}>{f.name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-gray-400">{cfg?.categories?.length || 0} cat · {cfg?.categories?.reduce((s: number, c: any) => s + (c.prompts?.length || 0), 0) || 0} prompts</span>
                        {cfg?.driveLink && (
                          <a href={cfg.driveLink} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-xs text-violet-500 flex items-center gap-1 hover:underline">
                            <Link2 className="h-3 w-3" /> Drive
                          </a>
                        )}
                      </div>
                    </div>
                    {isLinked && <CheckCircle className="h-4 w-4 text-violet-600 flex-shrink-0" />}
                  </button>
                )
              })}
              {aiFolders.length === 0 && <p className="text-xs text-gray-400 text-center py-3">Crie pastas em <strong>Pastas IA</strong> para vincular aqui</p>}
            </div>
            {linkedFolderConfig?.driveLink && (
              <div className="flex items-center gap-2 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
                <Link2 className="h-4 w-4 text-violet-500 flex-shrink-0" />
                <span className="text-xs text-violet-700 font-medium truncate flex-1">{linkedFolderConfig.driveLink}</span>
                <a href={linkedFolderConfig.driveLink} target="_blank" rel="noopener noreferrer" className="text-xs px-2 py-1 bg-violet-600 text-white rounded-lg whitespace-nowrap">Abrir Drive</a>
              </div>
            )}
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
                        <select value={tag.value} onChange={e => setClientTags(prev => prev.map(t => t.templateId === tag.templateId ? { ...t, value: e.target.value } : t))}
                          className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 ${tag.value ? 'text-gray-800' : 'text-gray-400'}`}>
                          <option value="">— Selecione —</option>
                          {options.map((opt: string, i: number) => <option key={i} value={opt}>{opt}</option>)}
                        </select>
                      ) : (
                        <input value={tag.value} onChange={e => setClientTags(prev => prev.map(t => t.templateId === tag.templateId ? { ...t, value: e.target.value } : t))}
                          placeholder="Digite o valor..." className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
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
              <textarea value={resultForm.observations} onChange={e => setResultForm({ ...resultForm, observations: e.target.value })}
                rows={4} placeholder="Comentários, recomendações, paleta de cores..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none" />
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
              <Btn onClick={async () => { await handleSaveResult(); await handleSaveAIConfig() }} loading={savingResult || savingAI}>
                <Save className="h-4 w-4" /> Salvar
              </Btn>
              {aiSaveStatus === 'saved' && <span className="text-sm text-green-600 flex items-center gap-1"><CheckCircle className="h-4 w-4" /> Salvo!</span>}
              <span className="text-xs text-gray-400 ml-auto flex items-center gap-1"><Lock className="h-3 w-3" /> Liberação somente na aba ✨ IA</span>
            </div>
          </div>
        </div>
      )}

      {tab === 'ai' && (
        <div className="max-w-3xl">
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <AIPromptConfig
              clientId={clientId!}
              clientName={client.full_name}
              isReleased={result?.is_released || false}
              onRelease={handleReleaseResult}
              releasingResult={releasingResult}
            />
          </div>
        </div>
      )}

      {showFormModal && formSubmission && (
        <FormResponseModal formSubmission={formSubmission} planForm={planForm} onClose={() => setShowFormModal(false)} />
      )}
    </div>
  )
}

// ─── Router ───────────────────────────────────────────────────────────────
export function ClientsManager() {
  return (
    <Routes>
      <Route index element={<ClientsList />} />
      <Route path=":clientId" element={<ClientDetail />} />
    </Routes>
  )
}