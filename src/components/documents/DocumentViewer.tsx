import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'

/**
 * ATENÇÃO — Esta página era um MOCKUP de demonstração:
 *   • Aceitava a senha fixa "demo123" (que aparecia na tela como "dica")
 *   • Mostrava "documentos" fictícios com botões que só chamavam alert()
 *   • Nada aqui se conectava ao banco real
 *
 * Foi neutralizada por motivo de segurança. O acesso real do cliente aos
 * próprios documentos acontece via portal (/c/:token), através das RPCs
 * get_client_portal, get_admin_content_for_client, sign_client_contract
 * etc, com isolamento multi-tenant correto.
 *
 * Se um dia for retomada essa rota, NÃO usar senha em texto:
 *   • Hashear (bcrypt/argon2) qualquer access_password persistido
 *   • Validar o token + senha via RPC SECURITY DEFINER, com rate limiting
 *   • Nunca mostrar dicas/valores de senha na UI
 */
export default function DocumentViewer() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()

  // Defesa adicional: se alguém acessar essa rota, redireciona pra home
  // depois de mostrar a mensagem por uns segundos.
  useEffect(() => {
    const t = setTimeout(() => navigate('/', { replace: true }), 5000)
    return () => clearTimeout(t)
  }, [navigate])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-amber-100 rounded-full mb-4">
            <AlertTriangle className="h-6 w-6 text-amber-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900">
            Página não disponível
          </h2>
          <p className="text-gray-600 mt-2">
            Esta rota não está mais ativa. Para acessar seus documentos,
            use o link do portal enviado pela sua consultora.
          </p>
          {token && (
            <p className="text-xs text-gray-400 mt-4 break-all">
              Ref: {token}
            </p>
          )}
          <p className="text-xs text-gray-500 mt-4">
            Você será redirecionado em alguns segundos...
          </p>
        </div>
      </div>
    </div>
  )
}