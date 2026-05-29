// src/components/admin/documents/client/IrisAnalysisSection.tsx
import { Eye, Pencil, Plus } from 'lucide-react'
import { useTheme } from '../../../../lib/theme'
import { IrisAnalysisRecord } from './irisAnalysisTypes'

interface Props {
  irisAnalysis: IrisAnalysisRecord | null
  onOpen: () => void
}

/**
 * Card visual que entra no ClientsManager, abaixo da Ferramenta de Contraste.
 * Espelha o padrão do bloco de Contraste: só renderiza o estado salvo + botão
 * que dispara `onOpen()`. Quem controla a abertura do dialog é o ClientsManager.
 */
export function IrisAnalysisSection({ irisAnalysis, onOpen }: Props) {
  const { theme: t } = useTheme()
  const hasSaved = !!irisAnalysis?.cardPngDataUrl

  return (
    <div
      className="rounded-xl p-5 space-y-4"
      style={{ background: t.surface, border: `1px solid ${t.border}` }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h3 className="font-semibold flex items-center gap-2" style={{ color: t.text }}>
          <Eye className="h-4 w-4 text-rose-500" /> Análise da Íris
        </h3>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-2 rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-600 w-full sm:w-auto justify-center whitespace-nowrap"
        >
          {hasSaved ? (
            <>
              <Pencil className="h-3.5 w-3.5" /> Editar
            </>
          ) : (
            <>
              <Plus className="h-3.5 w-3.5" /> Abrir ferramenta
            </>
          )}
        </button>
      </div>

      {hasSaved ? (
        <div
          className="flex flex-col sm:flex-row gap-3 p-3 rounded-lg"
          style={{ background: t.surface2, border: `1px solid ${t.border}` }}
        >
          <img
            src={irisAnalysis!.cardPngDataUrl}
            alt="Análise da íris gerada"
            className="w-full sm:w-44 h-auto rounded-md object-contain flex-shrink-0"
            style={{ background: t.surface, border: `1px solid ${t.border}` }}
          />
          <div className="flex-1 min-w-0">
            <p
              className="text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: t.text3 }}
            >
              Valor atual{' '}
              <span className="ml-1 normal-case font-normal" style={{ color: t.text3 }}>
                — disponível como <code>{'{{AnaliseIris}}'}</code> nos prompts
              </span>
            </p>
            <p
              className="text-sm font-semibold mt-1 break-words"
              style={{ color: t.text }}
            >
              {irisAnalysis!.title}
            </p>
            <p
              className="text-xs mt-0.5 line-clamp-3"
              style={{ color: t.text2 }}
            >
              {irisAnalysis!.body}
            </p>
            {irisAnalysis!.updatedAt && (
              <p className="text-[10px] mt-1.5" style={{ color: t.text3 }}>
                Atualizado em {new Date(irisAnalysis!.updatedAt).toLocaleString('pt-BR')}
              </p>
            )}
          </div>
        </div>
      ) : (
        <p
          className="text-sm py-4 text-center rounded-lg"
          style={{ color: t.text3, border: `1px dashed ${t.border}` }}
        >
          Ferramenta ainda não configurada para esta cliente.
        </p>
      )}
    </div>
  )
}