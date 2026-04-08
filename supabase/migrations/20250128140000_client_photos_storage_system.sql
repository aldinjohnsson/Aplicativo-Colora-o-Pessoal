-- Migration para Sistema de Armazenamento de Fotos
-- Execute este SQL no Supabase SQL Editor

-- 1. Criar tabela para armazenar metadados dos clientes
CREATE TABLE IF NOT EXISTS client_data (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  contract_data JSONB NOT NULL,
  form_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'completed' CHECK (status IN ('completed', 'in_progress')),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Criar tabela para armazenar metadados das fotos
CREATE TABLE IF NOT EXISTS client_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id TEXT NOT NULL REFERENCES client_data(client_id) ON DELETE CASCADE,
  photo_name TEXT NOT NULL,
  photo_type TEXT NOT NULL,
  photo_size BIGINT NOT NULL,
  storage_path TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, photo_name)
);

-- 3. Criar tabela para armazenar metadados dos anexos do formulário
CREATE TABLE IF NOT EXISTS client_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id TEXT NOT NULL REFERENCES client_data(client_id) ON DELETE CASCADE,
  attachment_name TEXT NOT NULL,
  attachment_type TEXT NOT NULL,
  attachment_size BIGINT NOT NULL,
  storage_path TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, attachment_name)
);

-- 4. Criar índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_client_data_email ON client_data(email);
CREATE INDEX IF NOT EXISTS idx_client_data_created_at ON client_data(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_photos_client_id ON client_photos(client_id);
CREATE INDEX IF NOT EXISTS idx_client_attachments_client_id ON client_attachments(client_id);

-- 5. Criar função para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Criar trigger para atualizar updated_at
DROP TRIGGER IF EXISTS update_client_data_updated_at ON client_data;
CREATE TRIGGER update_client_data_updated_at
    BEFORE UPDATE ON client_data
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 7. Habilitar Row Level Security (RLS)
ALTER TABLE client_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_attachments ENABLE ROW LEVEL SECURITY;

-- 8. Criar políticas de acesso (ajuste conforme sua necessidade de autenticação)
-- Por enquanto, permitindo acesso completo para desenvolvimento
CREATE POLICY "Enable all access for client_data" ON client_data FOR ALL USING (true);
CREATE POLICY "Enable all access for client_photos" ON client_photos FOR ALL USING (true);
CREATE POLICY "Enable all access for client_attachments" ON client_attachments FOR ALL USING (true);

-- 9. Criar bucket de storage para as fotos (execute no Supabase Dashboard -> Storage)
-- Nome do bucket: client-files
-- Public: false (para maior segurança)
-- Allowed MIME types: image/*, application/pdf, application/msword, etc.

-- 10. Criar políticas de storage (ajuste conforme necessário)
-- No Supabase Dashboard -> Storage -> client-files -> Policies
-- Adicionar política para permitir upload e download

-- Views úteis para o admin
CREATE OR REPLACE VIEW client_summary AS
SELECT 
  cd.client_id,
  cd.full_name,
  cd.email,
  cd.phone,
  cd.status,
  cd.created_at,
  cd.completed_at,
  COUNT(DISTINCT cp.id) as photo_count,
  COUNT(DISTINCT ca.id) as attachment_count,
  COALESCE(SUM(cp.photo_size), 0) as total_photo_size,
  COALESCE(SUM(ca.attachment_size), 0) as total_attachment_size
FROM client_data cd
LEFT JOIN client_photos cp ON cd.client_id = cp.client_id
LEFT JOIN client_attachments ca ON cd.client_id = ca.client_id
GROUP BY cd.client_id, cd.full_name, cd.email, cd.phone, cd.status, cd.created_at, cd.completed_at
ORDER BY cd.completed_at DESC;