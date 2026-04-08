# Sistema de Análise de Coloração Pessoal

Sistema completo para análise de coloração pessoal com integração ao Google Drive para organização automática de arquivos.

## Funcionalidades

### Para Clientes
- **Etapa 1**: Leitura e aceite do contrato (salvo como PDF)
- **Etapa 2**: Preenchimento de formulário personalizado (salvo como PDF + anexos)
- **Etapa 3**: Upload de fotos categorizadas (organizadas por tipo)

### Para Administradores
- Gestão de clientes e progresso
- Configuração da integração com Google Drive
- Visualização de arquivos organizados

## Integração Google Drive

O sistema organiza automaticamente os arquivos de cada cliente em uma estrutura de pastas:

```
📁 [Nome do Cliente]/
├── 📁 Contrato/
│   └── Contrato_[Nome]_[Data].pdf
├── 📁 Formulário/
│   ├── Formulario_[Nome]_[Data].pdf
│   └── Anexo_1_[arquivo]
└── 📁 Fotos/
    ├── Foto_1_sem_maquiagem.jpg
    ├── Foto_2_iris.jpg
    └── Foto_3_tecidos.jpg
```

## Configuração

### 1. Configurar Google Drive API

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/)
2. Crie um novo projeto ou selecione um existente
3. Ative a Google Drive API
4. Crie credenciais OAuth 2.0:
   - Tipo: Aplicação web
   - URIs de redirecionamento: `http://localhost:5173/auth/callback`
5. Copie o Client ID e Client Secret

### 2. Configurar Variáveis de Ambiente

Copie `.env.example` para `.env` e configure:

```env
VITE_GOOGLE_CLIENT_ID=seu_client_id_aqui
VITE_GOOGLE_CLIENT_SECRET=seu_client_secret_aqui
VITE_GOOGLE_REDIRECT_URI=http://localhost:5173/auth/callback
```

### 3. Executar o Sistema

```bash
npm install
npm run dev
```

## Como Usar

### Configuração Inicial (Admin)
1. Acesse o painel administrativo
2. Vá para a aba "Google Drive"
3. Clique em "Conectar com Google Drive"
4. Autorize o acesso na janela que abrir
5. Cole o código de autorização fornecido
6. Confirme a conexão

### Fluxo do Cliente
1. O cliente acessa o sistema
2. Lê e aceita o contrato (PDF gerado automaticamente)
3. Preenche o formulário personalizado (PDF + anexos salvos)
4. Faz upload das fotos categorizadas (organizadas por tipo)
5. Todos os arquivos são automaticamente organizados no Google Drive

## Tecnologias Utilizadas

- **Frontend**: React + TypeScript + Tailwind CSS
- **PDF Generation**: jsPDF
- **Google Drive**: Google APIs
- **Icons**: Lucide React
- **Build**: Vite

## Estrutura do Projeto

```
src/
├── components/
│   ├── admin/
│   │   ├── AdminDashboard.tsx
│   │   ├── ClientsManager.tsx
│   │   └── GoogleDriveSetup.tsx
│   ├── client/
│   │   ├── ClientDashboard.tsx
│   │   ├── ProgressIndicator.tsx
│   │   └── steps/
│   │       ├── ContractStep.tsx
│   │       ├── FormStep.tsx
│   │       └── PhotoStep.tsx
│   └── ui/
├── contexts/
│   └── GoogleDriveContext.tsx
├── lib/
│   └── googleDrive.ts
└── App.tsx
```

## Segurança

- Autenticação OAuth 2.0 com Google
- Tokens armazenados localmente (considere usar httpOnly cookies em produção)
- Permissões mínimas necessárias (apenas criação de arquivos e pastas)
- Validação de tipos de arquivo no upload

## Próximos Passos

- [ ] Implementar autenticação real de usuários
- [ ] Adicionar notificações por email
- [ ] Criar relatórios de análise
- [ ] Implementar backup automático
- [ ] Adicionar suporte a múltiplos idiomas