-- ============================================================
-- MS Colors - Sistema de Gestão de Clientes
-- Migration 001 - Schema completo
-- ============================================================

-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ADMIN USERS
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- PLANOS
-- ============================================================

CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  deadline_days integer NOT NULL DEFAULT 5,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Contrato do plano
CREATE TABLE IF NOT EXISTS plan_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS',
  sections jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz DEFAULT now(),
  UNIQUE(plan_id)
);

-- Formulário do plano
CREATE TABLE IF NOT EXISTS plan_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Formulário de Análise',
  description text,
  fields jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz DEFAULT now(),
  UNIQUE(plan_id)
);

-- Categorias de fotos do plano
CREATE TABLE IF NOT EXISTS plan_photo_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  instructions jsonb NOT NULL DEFAULT '[]',
  video_url text,
  max_photos integer NOT NULL DEFAULT 10,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- CLIENTES
-- ============================================================

CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  plan_id uuid REFERENCES plans(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  notes text,  -- observações internas do admin
  status text NOT NULL DEFAULT 'awaiting_contract'
    CHECK (status IN (
      'awaiting_contract',
      'awaiting_form',
      'awaiting_photos',
      'in_analysis',
      'completed'
    )),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Assinatura do contrato
CREATE TABLE IF NOT EXISTS client_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  signed_at timestamptz DEFAULT now(),
  UNIQUE(client_id)
);

-- Submissão do formulário
CREATE TABLE IF NOT EXISTS client_form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  form_data jsonb NOT NULL DEFAULT '{}',
  submitted_at timestamptz DEFAULT now(),
  UNIQUE(client_id)
);

-- Fotos (metadados — arquivo no storage)
CREATE TABLE IF NOT EXISTS client_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  category_id uuid REFERENCES plan_photo_categories(id) ON DELETE SET NULL,
  photo_name text NOT NULL,
  photo_type text NOT NULL,
  photo_size bigint NOT NULL,
  storage_path text NOT NULL UNIQUE,
  uploaded_at timestamptz DEFAULT now()
);

-- Prazo calculado
CREATE TABLE IF NOT EXISTS client_deadlines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  photos_sent_at timestamptz NOT NULL,
  deadline_date date NOT NULL,
  UNIQUE(client_id)
);

-- Resultado (liberado pelo admin)
CREATE TABLE IF NOT EXISTS client_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  folder_url text,
  observations text,
  is_released boolean DEFAULT false,
  released_at timestamptz,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(client_id)
);

-- Arquivos do resultado (PDFs que o admin faz upload)
CREATE TABLE IF NOT EXISTS client_result_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  storage_path text NOT NULL UNIQUE,
  file_size bigint NOT NULL,
  uploaded_at timestamptz DEFAULT now()
);

-- ============================================================
-- ÍNDICES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_clients_token ON clients(token);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_plan_id ON clients(plan_id);
CREATE INDEX IF NOT EXISTS idx_client_photos_client_id ON client_photos(client_id);
CREATE INDEX IF NOT EXISTS idx_client_result_files_client_id ON client_result_files(client_id);
CREATE INDEX IF NOT EXISTS idx_plan_photo_categories_plan_id ON plan_photo_categories(plan_id);

-- ============================================================
-- TRIGGERS updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_plans_updated_at ON plans;
CREATE TRIGGER trg_plans_updated_at BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_clients_updated_at ON clients;
CREATE TRIGGER trg_clients_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_client_results_updated_at ON client_results;
CREATE TRIGGER trg_client_results_updated_at BEFORE UPDATE ON client_results
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('client-photos', 'client-photos', false, 52428800, ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif']),
  ('client-results', 'client-results', false, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_photo_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_deadlines ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_result_files ENABLE ROW LEVEL SECURITY;

-- Função auxiliar: verifica se o usuário autenticado é admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_users WHERE id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ---- ADMIN_USERS ----
CREATE POLICY "admin_users_self" ON admin_users
  FOR SELECT TO authenticated USING (id = auth.uid());

-- ---- PLANS ----
CREATE POLICY "plans_admin_all" ON plans
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "plans_anon_read" ON plans
  FOR SELECT TO anon USING (is_active = true);

-- ---- PLAN_CONTRACTS ----
CREATE POLICY "plan_contracts_admin" ON plan_contracts
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "plan_contracts_anon_read" ON plan_contracts
  FOR SELECT TO anon USING (true);

-- ---- PLAN_FORMS ----
CREATE POLICY "plan_forms_admin" ON plan_forms
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "plan_forms_anon_read" ON plan_forms
  FOR SELECT TO anon USING (true);

-- ---- PLAN_PHOTO_CATEGORIES ----
CREATE POLICY "photo_categories_admin" ON plan_photo_categories
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "photo_categories_anon_read" ON plan_photo_categories
  FOR SELECT TO anon USING (true);

-- ---- CLIENTS ----
CREATE POLICY "clients_admin_all" ON clients
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ---- CLIENT_CONTRACTS ----
CREATE POLICY "client_contracts_admin" ON client_contracts
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ---- CLIENT_FORM_SUBMISSIONS ----
CREATE POLICY "client_form_admin" ON client_form_submissions
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ---- CLIENT_PHOTOS ----
CREATE POLICY "client_photos_admin" ON client_photos
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ---- CLIENT_DEADLINES ----
CREATE POLICY "client_deadlines_admin" ON client_deadlines
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ---- CLIENT_RESULTS ----
CREATE POLICY "client_results_admin" ON client_results
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ---- CLIENT_RESULT_FILES ----
CREATE POLICY "client_result_files_admin" ON client_result_files
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ---- STORAGE ----
CREATE POLICY "storage_client_photos_admin" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'client-photos' AND is_admin())
  WITH CHECK (bucket_id = 'client-photos' AND is_admin());

CREATE POLICY "storage_client_results_admin" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'client-results' AND is_admin())
  WITH CHECK (bucket_id = 'client-results' AND is_admin());

-- Anon pode fazer upload de fotos (cliente sem login)
CREATE POLICY "storage_client_photos_anon_upload" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'client-photos');

-- ============================================================
-- RPC FUNCTIONS — ACESSO DO CLIENTE VIA TOKEN
-- Todas SECURITY DEFINER para bypassar RLS
-- ============================================================

-- Busca todos os dados do cliente pelo token
CREATE OR REPLACE FUNCTION get_client_portal(p_token text)
RETURNS json AS $$
DECLARE
  v_client clients%ROWTYPE;
  v_plan plans%ROWTYPE;
  v_contract plan_contracts%ROWTYPE;
  v_form plan_forms%ROWTYPE;
  v_categories json;
  v_signature client_contracts%ROWTYPE;
  v_form_submission client_form_submissions%ROWTYPE;
  v_photos json;
  v_deadline client_deadlines%ROWTYPE;
  v_result client_results%ROWTYPE;
  v_result_files json;
BEGIN
  -- Buscar cliente
  SELECT * INTO v_client FROM clients WHERE token = p_token;
  IF NOT FOUND THEN RETURN json_build_object('error', 'Token inválido'); END IF;

  -- Buscar plano
  SELECT * INTO v_plan FROM plans WHERE id = v_client.plan_id;

  -- Buscar contrato do plano
  SELECT * INTO v_contract FROM plan_contracts WHERE plan_id = v_client.plan_id;

  -- Buscar formulário do plano
  SELECT * INTO v_form FROM plan_forms WHERE plan_id = v_client.plan_id;

  -- Buscar categorias de fotos
  SELECT json_agg(c ORDER BY c.order_index) INTO v_categories
  FROM plan_photo_categories c WHERE c.plan_id = v_client.plan_id;

  -- Buscar assinatura do contrato
  SELECT * INTO v_signature FROM client_contracts WHERE client_id = v_client.id;

  -- Buscar submissão do formulário
  SELECT * INTO v_form_submission FROM client_form_submissions WHERE client_id = v_client.id;

  -- Buscar fotos (só metadados)
  SELECT json_agg(json_build_object(
    'id', p.id,
    'photo_name', p.photo_name,
    'photo_size', p.photo_size,
    'category_id', p.category_id,
    'uploaded_at', p.uploaded_at
  )) INTO v_photos FROM client_photos p WHERE p.client_id = v_client.id;

  -- Buscar prazo
  SELECT * INTO v_deadline FROM client_deadlines WHERE client_id = v_client.id;

  -- Buscar resultado (só se liberado)
  SELECT * INTO v_result FROM client_results WHERE client_id = v_client.id AND is_released = true;

  -- Buscar arquivos do resultado
  IF v_result IS NOT NULL THEN
    SELECT json_agg(json_build_object(
      'id', f.id,
      'file_name', f.file_name,
      'storage_path', f.storage_path,
      'file_size', f.file_size
    )) INTO v_result_files FROM client_result_files f WHERE f.client_id = v_client.id;
  END IF;

  RETURN json_build_object(
    'client', json_build_object(
      'id', v_client.id,
      'full_name', v_client.full_name,
      'email', v_client.email,
      'phone', v_client.phone,
      'status', v_client.status,
      'created_at', v_client.created_at
    ),
    'plan', CASE WHEN v_plan.id IS NOT NULL THEN json_build_object(
      'id', v_plan.id,
      'name', v_plan.name,
      'deadline_days', v_plan.deadline_days
    ) ELSE NULL END,
    'contract', CASE WHEN v_contract.id IS NOT NULL THEN json_build_object(
      'title', v_contract.title,
      'sections', v_contract.sections
    ) ELSE NULL END,
    'form', CASE WHEN v_form.id IS NOT NULL THEN json_build_object(
      'title', v_form.title,
      'description', v_form.description,
      'fields', v_form.fields
    ) ELSE NULL END,
    'photo_categories', COALESCE(v_categories, '[]'::json),
    'contract_signed', v_signature.id IS NOT NULL,
    'contract_signed_at', v_signature.signed_at,
    'form_submitted', v_form_submission.id IS NOT NULL,
    'form_submitted_at', v_form_submission.submitted_at,
    'photos', COALESCE(v_photos, '[]'::json),
    'deadline', CASE WHEN v_deadline.id IS NOT NULL THEN json_build_object(
      'photos_sent_at', v_deadline.photos_sent_at,
      'deadline_date', v_deadline.deadline_date
    ) ELSE NULL END,
    'result', CASE WHEN v_result.id IS NOT NULL THEN json_build_object(
      'folder_url', v_result.folder_url,
      'observations', v_result.observations,
      'released_at', v_result.released_at,
      'files', COALESCE(v_result_files, '[]'::json)
    ) ELSE NULL END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Assinar contrato
CREATE OR REPLACE FUNCTION sign_client_contract(p_token text)
RETURNS json AS $$
DECLARE
  v_client clients%ROWTYPE;
BEGIN
  SELECT * INTO v_client FROM clients WHERE token = p_token;
  IF NOT FOUND THEN RETURN json_build_object('error', 'Token inválido'); END IF;
  IF v_client.status != 'awaiting_contract' THEN
    RETURN json_build_object('error', 'Contrato já assinado');
  END IF;

  INSERT INTO client_contracts (client_id) VALUES (v_client.id)
  ON CONFLICT (client_id) DO NOTHING;

  UPDATE clients SET status = 'awaiting_form' WHERE id = v_client.id;

  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Submeter formulário
CREATE OR REPLACE FUNCTION submit_client_form(p_token text, p_form_data jsonb)
RETURNS json AS $$
DECLARE
  v_client clients%ROWTYPE;
BEGIN
  SELECT * INTO v_client FROM clients WHERE token = p_token;
  IF NOT FOUND THEN RETURN json_build_object('error', 'Token inválido'); END IF;
  IF v_client.status != 'awaiting_form' THEN
    RETURN json_build_object('error', 'Status inválido para envio de formulário');
  END IF;

  INSERT INTO client_form_submissions (client_id, form_data)
  VALUES (v_client.id, p_form_data)
  ON CONFLICT (client_id) DO UPDATE SET form_data = p_form_data, submitted_at = now();

  UPDATE clients SET status = 'awaiting_photos' WHERE id = v_client.id;

  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Salvar metadados de foto após upload no storage
CREATE OR REPLACE FUNCTION save_client_photo(
  p_token text,
  p_photo_name text,
  p_photo_type text,
  p_photo_size bigint,
  p_storage_path text,
  p_category_id uuid DEFAULT NULL
)
RETURNS json AS $$
DECLARE
  v_client clients%ROWTYPE;
BEGIN
  SELECT * INTO v_client FROM clients WHERE token = p_token;
  IF NOT FOUND THEN RETURN json_build_object('error', 'Token inválido'); END IF;
  IF v_client.status != 'awaiting_photos' THEN
    RETURN json_build_object('error', 'Status inválido para envio de fotos');
  END IF;

  INSERT INTO client_photos (client_id, category_id, photo_name, photo_type, photo_size, storage_path)
  VALUES (v_client.id, p_category_id, p_photo_name, p_photo_type, p_photo_size, p_storage_path)
  ON CONFLICT (storage_path) DO NOTHING;

  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Finalizar envio de fotos (admin ou cliente ao clicar em finalizar)
CREATE OR REPLACE FUNCTION finalize_client_photos(p_token text, p_deadline_date date, p_photos_sent_at timestamptz)
RETURNS json AS $$
DECLARE
  v_client clients%ROWTYPE;
BEGIN
  SELECT * INTO v_client FROM clients WHERE token = p_token;
  IF NOT FOUND THEN RETURN json_build_object('error', 'Token inválido'); END IF;
  IF v_client.status != 'awaiting_photos' THEN
    RETURN json_build_object('error', 'Status inválido');
  END IF;

  INSERT INTO client_deadlines (client_id, photos_sent_at, deadline_date)
  VALUES (v_client.id, p_photos_sent_at, p_deadline_date)
  ON CONFLICT (client_id) DO UPDATE SET
    photos_sent_at = p_photos_sent_at,
    deadline_date = p_deadline_date;

  UPDATE clients SET status = 'in_analysis' WHERE id = v_client.id;

  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Gerar URL pública assinada para download de arquivo de resultado
CREATE OR REPLACE FUNCTION get_result_file_url(p_token text, p_storage_path text)
RETURNS json AS $$
DECLARE
  v_client clients%ROWTYPE;
  v_result client_results%ROWTYPE;
BEGIN
  SELECT * INTO v_client FROM clients WHERE token = p_token;
  IF NOT FOUND THEN RETURN json_build_object('error', 'Token inválido'); END IF;

  SELECT * INTO v_result FROM client_results
  WHERE client_id = v_client.id AND is_released = true;
  IF NOT FOUND THEN RETURN json_build_object('error', 'Resultado não liberado'); END IF;

  -- Verificar que o arquivo pertence ao cliente
  IF NOT EXISTS (
    SELECT 1 FROM client_result_files
    WHERE client_id = v_client.id AND storage_path = p_storage_path
  ) THEN
    RETURN json_build_object('error', 'Arquivo não encontrado');
  END IF;

  RETURN json_build_object('ok', true, 'path', p_storage_path);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Gerar URL assinada de foto do cliente (para o admin visualizar)
CREATE OR REPLACE FUNCTION get_client_photo_url(p_token text, p_storage_path text)
RETURNS json AS $$
DECLARE
  v_client clients%ROWTYPE;
BEGIN
  SELECT * INTO v_client FROM clients WHERE token = p_token;
  IF NOT FOUND THEN RETURN json_build_object('error', 'Token inválido'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM client_photos
    WHERE client_id = v_client.id AND storage_path = p_storage_path
  ) THEN
    RETURN json_build_object('error', 'Foto não encontrada');
  END IF;

  RETURN json_build_object('ok', true, 'path', p_storage_path);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- DADOS INICIAIS DE EXEMPLO
-- ============================================================

INSERT INTO plans (name, description, deadline_days) VALUES
  ('Análise Individual', 'Análise de coloração pessoal completa', 5),
  ('Análise Express', 'Análise com entrega em 3 dias úteis', 3)
ON CONFLICT DO NOTHING;

-- Contrato padrão para o primeiro plano
INSERT INTO plan_contracts (plan_id, title, sections)
SELECT 
  id,
  'CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE ANÁLISE DE COLORAÇÃO PESSOAL',
  '[
    {"id":"1","title":"1. OBJETO","content":"Este contrato tem por objeto a prestação de serviços de análise de coloração pessoal, incluindo avaliação de características físicas e recomendações de paleta de cores.","order":1},
    {"id":"2","title":"2. RESPONSABILIDADES DO CLIENTE","content":"Fornecer informações verdadeiras no formulário e enviar fotos conforme instruções específicas.","order":2},
    {"id":"3","title":"3. CONFIDENCIALIDADE","content":"Todas as informações e imagens fornecidas serão utilizadas exclusivamente para a análise contratada e mantidas em sigilo.","order":3},
    {"id":"4","title":"4. PRAZO","content":"O prazo para entrega da análise é contado em dias úteis a partir do recebimento completo das fotos.","order":4}
  ]'::jsonb
FROM plans WHERE name = 'Análise Individual'
ON CONFLICT DO NOTHING;

-- Adiciona constraint única na tabela client_photos
ALTER TABLE client_photos
ADD CONSTRAINT client_photos_storage_path_key 
UNIQUE (storage_path);

INSERT INTO storage.buckets (id, name, public)
VALUES ('client-photos', 'client-photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read client-photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'client-photos');

CREATE POLICY "Allow insert client-photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'client-photos');

INSERT INTO storage.buckets (id, name, public)
VALUES ('client-photos', 'client-photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read client-photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'client-photos');

CREATE POLICY "Allow insert client-photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'client-photos');

ALTER TABLE clients ADD COLUMN ai_reference_photo_path TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ai_profile jsonb;

-- Executar no Supabase SQL Editor

-- 1. Coluna ai_profile (se ainda não existe)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ai_profile jsonb;

-- 2. Tabela para templates de pastas (reutilizáveis entre clientes)
CREATE TABLE IF NOT EXISTS ai_folders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text UNIQUE NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 3. RLS (Row Level Security) - permitir acesso autenticado
ALTER TABLE ai_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated" ON ai_folders
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- Executar no Supabase SQL Editor

-- 1. Tabela de pastas de prompts (global, usada em Configurações)
CREATE TABLE IF NOT EXISTS ai_folders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE ai_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_ai_folders" ON ai_folders FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. Coluna no clients para vincular pasta + foto
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ai_folder_id uuid REFERENCES ai_folders(id) ON DELETE SET NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ai_reference_photo_path text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ai_prompt text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ai_profile jsonb;

-- Executar no Supabase SQL Editor

-- Créditos por cliente
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ai_credits_image integer DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ai_credits_text integer DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ai_credits_used_image integer DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ai_credits_used_text integer DEFAULT 0;

-- Função para consumir crédito (chamada pelo frontend via RPC)
CREATE OR REPLACE FUNCTION use_ai_credit(p_client_id uuid, p_type text)
RETURNS jsonb AS $$
DECLARE
  v_available integer;
  v_used integer;
BEGIN
  IF p_type = 'image' THEN
    SELECT ai_credits_image, ai_credits_used_image INTO v_available, v_used
    FROM clients WHERE id = p_client_id;
    
    IF v_available IS NULL OR v_available <= 0 THEN
      RETURN jsonb_build_object('error', 'Sem créditos de imagem disponíveis', 'remaining', 0);
    END IF;
    
    UPDATE clients 
    SET ai_credits_image = ai_credits_image - 1,
        ai_credits_used_image = COALESCE(ai_credits_used_image, 0) + 1
    WHERE id = p_client_id;
    
    RETURN jsonb_build_object('ok', true, 'remaining', v_available - 1);
    
  ELSIF p_type = 'text' THEN
    SELECT ai_credits_text, ai_credits_used_text INTO v_available, v_used
    FROM clients WHERE id = p_client_id;
    
    IF v_available IS NULL OR v_available <= 0 THEN
      RETURN jsonb_build_object('error', 'Sem créditos de texto disponíveis', 'remaining', 0);
    END IF;
    
    UPDATE clients 
    SET ai_credits_text = ai_credits_text - 1,
        ai_credits_used_text = COALESCE(ai_credits_used_text, 0) + 1
    WHERE id = p_client_id;
    
    RETURN jsonb_build_object('ok', true, 'remaining', v_available - 1);
  ELSE
    RETURN jsonb_build_object('error', 'Tipo inválido');
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função para checar créditos
CREATE OR REPLACE FUNCTION check_ai_credits(p_client_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_img integer;
  v_txt integer;
  v_used_img integer;
  v_used_txt integer;
BEGIN
  SELECT ai_credits_image, ai_credits_text, 
         COALESCE(ai_credits_used_image, 0), COALESCE(ai_credits_used_text, 0)
  INTO v_img, v_txt, v_used_img, v_used_txt
  FROM clients WHERE id = p_client_id;
  
  RETURN jsonb_build_object(
    'image', COALESCE(v_img, 0),
    'text', COALESCE(v_txt, 0),
    'used_image', v_used_img,
    'used_text', v_used_txt
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Executar no Supabase SQL Editor

-- 1. Tabela de modelos de tags (global, definido em Configurações)
CREATE TABLE IF NOT EXISTS ai_info_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  placeholder text DEFAULT '',
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE ai_info_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_ai_info_templates" ON ai_info_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. Coluna no clients para guardar as tags preenchidas (JSON)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ai_info_tags jsonb DEFAULT '[]';

-- 3. Inserir tags padrão (pode remover/editar depois)
INSERT INTO ai_info_templates (name, placeholder, sort_order) VALUES
  ('Cartela de Cores', 'Ex: Verão Suave', 0),
  ('Temperatura da Pele', 'Ex: Neutra Fria', 1),
  ('Subtom', 'Ex: Avermelhado e Azulado Arroxeado', 2),
  ('Contraste Pessoal', 'Ex: Médio a Alto', 3),
  ('Característica Principal', 'Ex: Harmonia com cores suaves', 4),
  ('Cores que Favorecem', 'Ex: Fendi, Off White, Verde Esmeralda, Lilás...', 5),
  ('Cores para Evitar', 'Ex: Dourado, Acobreado, Laranja...', 6),
  ('Loiro Ideal', 'Ex: Tom neutro frio, mechas finas, raiz esfumada', 7),
  ('Nuances de Tinta', 'Ex: 8.01, 88.71, 9.8, 9.01', 8),
  ('Ruivo Ideal', 'Ex: Médio, avermelhado e frio - 8.22 Rose Gold', 9),
  ('Observações Gerais', 'Informações adicionais sobre a cliente', 10)
ON CONFLICT DO NOTHING;

-- Adicionar coluna options se não existe
ALTER TABLE ai_info_templates ADD COLUMN IF NOT EXISTS options jsonb DEFAULT '[]';

-- Limpar dados antigos e inserir novos
DELETE FROM ai_info_templates;

INSERT INTO ai_info_templates (name, options, sort_order) VALUES
  ('Coloração Pessoal', '["Primavera Clara","Primavera Quente","Primavera Brilhante","Verão Suave","Verão Frio","Verão Claro","Outono Suave","Outono Quente","Outono Profundo","Inverno Brilhante","Inverno Frio","Inverno Profundo"]', 0),
  ('Temperatura da Pele', '["Quente","Fria","Neutra Quente","Neutra Fria"]', 1),
  ('Subtom', '["Avermelhado","Azulado","Amarelado","Dourado","Rosado","Acinzentado","Avermelhado e Azulado Arroxeado","Oliva"]', 2),
  ('Contraste Pessoal', '["Baixo","Médio Baixo","Médio","Médio Alto","Alto"]', 3),
  ('Característica Principal', '["Harmonia com cores suaves (opacas)","Harmonia com cores intensas (vibrantes)","Harmonia com cores claras","Harmonia com cores escuras"]', 4);

  -- 6. Login do cliente (email + data nascimento)
DROP FUNCTION IF EXISTS get_client_token_by_credentials(text, date);

CREATE OR REPLACE FUNCTION get_client_token_by_credentials(p_email text, p_birth_date date)
RETURNS jsonb AS $$
DECLARE
  v_client record;
BEGIN
  SELECT id, token, full_name, birth_date INTO v_client
  FROM clients WHERE email = lower(p_email);
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'E-mail não encontrado. Verifique o e-mail cadastrado.');
  END IF;
  
  IF v_client.birth_date IS NULL OR v_client.birth_date != p_birth_date THEN
    RETURN jsonb_build_object('error', 'Data de nascimento incorreta.');
  END IF;
  
  RETURN jsonb_build_object('token', v_client.token, 'name', v_client.full_name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Adicionar colunas na tabela plans
ALTER TABLE plans 
  ADD COLUMN IF NOT EXISTS share_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS contract jsonb,
  ADD COLUMN IF NOT EXISTS form_config jsonb,
  ADD COLUMN IF NOT EXISTS photo_categories jsonb;

-- Gerar share_token para planos existentes
UPDATE plans 
SET share_token = encode(gen_random_bytes(12), 'hex')
WHERE share_token IS NULL;

-- Adicionar colunas na tabela clients
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS step_contract boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS step_form boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS step_photos boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS token text UNIQUE;

-- Criar tabela client_contracts se não existir
CREATE TABLE IF NOT EXISTS client_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  contract_data jsonb,
  signed_at timestamptz DEFAULT now()
);

-- Adicionar coluna que falta
ALTER TABLE client_contracts 
  ADD COLUMN IF NOT EXISTS contract_data jsonb;

-- Recriar a função sem o erro
CREATE OR REPLACE FUNCTION register_client_from_plan(
  p_share_token text,
  p_full_name text,
  p_email text,
  p_phone text,
  p_birth_date date,
  p_contract_data jsonb DEFAULT '{}'
)
RETURNS jsonb AS $$
DECLARE
  v_plan_id uuid;
  v_client_id uuid;
  v_token text;
  v_existing uuid;
  v_existing_token text;
BEGIN
  SELECT id INTO v_plan_id FROM plans WHERE share_token = p_share_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Plano não encontrado. Verifique o link.');
  END IF;

  SELECT id, token INTO v_existing, v_existing_token
  FROM clients WHERE email = lower(p_email);
  
  IF FOUND THEN
    RETURN jsonb_build_object('client_id', v_existing, 'token', v_existing_token, 'existing', true);
  END IF;

  v_token := encode(gen_random_bytes(24), 'hex');

  INSERT INTO clients (
    full_name, email, phone, birth_date, plan_id, token,
    status, step_contract, step_form, step_photos
  )
  VALUES (
    p_full_name, lower(p_email), p_phone, p_birth_date, v_plan_id, v_token,
    'awaiting_form', true, false, false
  )
  RETURNING id INTO v_client_id;

  INSERT INTO client_contracts (client_id, contract_data, signed_at)
  VALUES (v_client_id, p_contract_data, now())
  ON CONFLICT (client_id) DO UPDATE 
    SET contract_data = EXCLUDED.contract_data,
        signed_at = EXCLUDED.signed_at;

  RETURN jsonb_build_object('client_id', v_client_id, 'token', v_token, 'existing', false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Confirmar
SELECT column_name FROM information_schema.columns WHERE table_name = 'client_contracts';

-- Permite o tipo 'settings' na tabela admin_content
ALTER TABLE admin_content
  DROP CONSTRAINT IF EXISTS admin_content_type_check;

ALTER TABLE admin_content
  ADD CONSTRAINT admin_content_type_check
  CHECK (type IN ('contract', 'form', 'instructions', 'settings'));

-- Verificar (compatível com PostgreSQL 12+)
SELECT conname, pg_get_constraintdef(oid) AS consrc
FROM pg_constraint
WHERE conname = 'admin_content_type_check';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ai_reference_photos jsonb DEFAULT '[]';


create table ai_sub_options (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('length', 'texture')),
  name text not null default '',
  instruction text default '',
  thumbnail jsonb,
  images jsonb default '[]',
  created_at timestamptz default now()
);

-- liberar insert
create policy "Allow insert ai_sub_options"
on ai_sub_options
for insert
with check (true);

-- liberar select (pra aparecer na biblioteca)
create policy "Allow select ai_sub_options"
on ai_sub_options
for select
using (true);

-- liberar update (edição)
create policy "Allow update ai_sub_options"
on ai_sub_options
for update
using (true);

-- liberar delete
create policy "Allow delete ai_sub_options"
on ai_sub_options
for delete
using (true);

-- Remove as duas versões conflitantes
DROP FUNCTION IF EXISTS public.finalize_client_photos(text, date, timestamptz);
DROP FUNCTION IF EXISTS public.finalize_client_photos(text, text, timestamptz);

-- Recria apenas uma versão (com TEXT, que é o que o app envia)
CREATE OR REPLACE FUNCTION finalize_client_photos(
  p_token TEXT,
  p_deadline_date TEXT,
  p_photos_sent_at TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_client_id UUID;
  v_current_status TEXT;
BEGIN
  SELECT id, status INTO v_client_id, v_current_status
  FROM clients
  WHERE token = p_token;

  IF v_client_id IS NULL THEN
    RETURN json_build_object('error', 'Cliente não encontrado');
  END IF;

  IF v_current_status NOT IN ('awaiting_photos', 'photos_submitted') THEN
    RETURN json_build_object('error', 'Fotos não podem ser finalizadas neste momento');
  END IF;

  UPDATE clients
  SET status = 'photos_submitted',
      updated_at = NOW()
  WHERE id = v_client_id;

  INSERT INTO client_deadlines (client_id, photos_sent_at, updated_at)
  VALUES (v_client_id, p_photos_sent_at, NOW())
  ON CONFLICT (client_id) DO UPDATE
  SET photos_sent_at = p_photos_sent_at,
      updated_at = NOW();

  RETURN json_build_object('success', true);
END;
$$;

-- Cria a tabela de categorias de fotos
CREATE TABLE photo_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL DEFAULT '',
  description   text NOT NULL DEFAULT '',
  instruction_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  max_photos    integer NOT NULL DEFAULT 3,
  "order"       integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Atualiza updated_at automaticamente em cada UPDATE
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER photo_categories_updated_at
  BEFORE UPDATE ON photo_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS (habilita mas permite tudo por enquanto — ajuste conforme sua auth)
ALTER TABLE photo_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access"
  ON photo_categories FOR ALL
  USING (true) WITH CHECK (true);

-- Bucket para as imagens de instrução
INSERT INTO storage.buckets (id, name, public)
  VALUES ('category-instructions', 'category-instructions', true)
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read instructions"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'category-instructions');

CREATE POLICY "Authenticated upload instructions"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'category-instructions');

  ALTER TABLE plan_photo_categories
  ADD COLUMN IF NOT EXISTS instruction_items jsonb NOT NULL DEFAULT '[]'::jsonb;

  -- ══════════════════════════════════════════════════════════════════════════
-- MS Colors — Migração para fluxo de rejeição/reenvio (CORRIGIDA v4)
-- Execute no SQL Editor do Supabase de uma vez só.
-- ══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. Colunas de rastreio de rejeição na tabela `clients`
-- ───────────────────────────────────────────────────────────────────────────

alter table public.clients
  add column if not exists form_rejection_reason   text,
  add column if not exists form_rejected_at        timestamptz,
  add column if not exists photos_rejection_reason text,
  add column if not exists photos_rejected_at      timestamptz;

create index if not exists idx_clients_form_rejected_at
  on public.clients (form_rejected_at)
  where form_rejected_at is not null;

create index if not exists idx_clients_photos_rejected_at
  on public.clients (photos_rejected_at)
  where photos_rejected_at is not null;


-- ───────────────────────────────────────────────────────────────────────────
-- 2. RPC: get_client_portal_extras — language sql puro, sem variáveis
-- ───────────────────────────────────────────────────────────────────────────

create or replace function public.get_client_portal_extras(p_token text)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'form_rejection_reason',   c.form_rejection_reason,
    'form_rejected_at',        c.form_rejected_at,
    'photos_rejection_reason', c.photos_rejection_reason,
    'photos_rejected_at',      c.photos_rejected_at,
    'form_submission',
      case
        when fs.form_data is null then null
        else jsonb_build_object(
          'form_data',    fs.form_data,
          'submitted_at', fs.submitted_at
        )
      end,
    'photo_paths', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'photo_name', p.photo_name,
            'category_id', p.category_id,
            'storage_path', p.storage_path
          )
          order by p.uploaded_at
        )
        from public.client_photos p
        where p.client_id = c.id
      ),
      '[]'::jsonb
    )
  )
  from public.clients c
  left join public.client_form_submissions fs
         on fs.client_id = c.id
  where c.token = p_token;
$$;

grant execute on function public.get_client_portal_extras(text) to anon, authenticated;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. RPC: delete_client_photo — language sql puro com CTE
--
-- A CTE "photo_delete" usa DELETE ... USING para garantir que só apaga
-- fotos que pertencem ao cliente do token. Se o token não existir,
-- client_lookup retorna vazio e o DELETE não bate em nada.
-- ───────────────────────────────────────────────────────────────────────────

create or replace function public.delete_client_photo(
  p_token    text,
  p_photo_id uuid
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with
  client_lookup as (
    select id
    from public.clients
    where token = p_token
  ),
  photo_delete as (
    delete from public.client_photos cp
    using client_lookup cl
    where cp.id        = p_photo_id
      and cp.client_id = cl.id
    returning cp.storage_path
  )
  select
    case
      when (select count(*) from client_lookup) = 0
        then jsonb_build_object('error', 'Cliente não encontrado')
      when (select count(*) from photo_delete) = 0
        then jsonb_build_object('error', 'Foto não encontrada')
      else
        jsonb_build_object('ok', true, 'storage_path', (select storage_path from photo_delete))
    end;
$$;

grant execute on function public.delete_client_photo(text, uuid) to anon, authenticated;


