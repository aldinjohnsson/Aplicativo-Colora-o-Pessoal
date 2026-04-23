-- ══════════════════════════════════════════════════════════════════════════
-- ClientsManager — Gerador de Documento (Fase 1)
--
-- Tabelas, triggers, RLS e buckets de storage necessários para:
--   • Tags reutilizáveis   (document_tags)
--   • Templates de PDF     (document_templates)
--   • Elementos posicionados no template (document_template_elements)
--   • Histórico de documentos gerados (client_generated_documents)
--
-- Execute este arquivo no SQL Editor do Supabase. É idempotente: pode rodar
-- múltiplas vezes sem criar duplicatas.
-- ══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. TAGS (slots reutilizáveis)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_tags (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,                         -- "Melhores fotos 1"
  slug         text UNIQUE NOT NULL,                  -- "melhores_fotos_1"
  type         text NOT NULL CHECK (type IN ('text','image')),
  description  text,                                  -- dica/propósito da tag
  default_hint jsonb NOT NULL DEFAULT '{}'::jsonb,    -- sugestão de origem (opcional)
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_tags_active_name
  ON document_tags(is_active, name);


-- ───────────────────────────────────────────────────────────────────────────
-- 2. TEMPLATES (PDF base + metadados por template)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  description     text,
  plan_id         uuid REFERENCES plans(id) ON DELETE SET NULL,  -- vínculo opcional a um plano
  base_pdf_path   text NOT NULL,                      -- storage: document-templates/{id}/base.pdf
  page_count      integer NOT NULL DEFAULT 1,
  page_width_pt   double precision NOT NULL,          -- dimensões nativas em pontos PDF
  page_height_pt  double precision NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_templates_active_name
  ON document_templates(is_active, name);
CREATE INDEX IF NOT EXISTS idx_document_templates_plan
  ON document_templates(plan_id) WHERE plan_id IS NOT NULL;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. ELEMENTOS (cada tag posicionada dentro de um template)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_template_elements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  uuid NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
  tag_id       uuid NOT NULL REFERENCES document_tags(id) ON DELETE RESTRICT,
  page_number  integer NOT NULL DEFAULT 1,
  x_pt         double precision NOT NULL,             -- origem: top-left da página
  y_pt         double precision NOT NULL,
  width_pt     double precision,                      -- null = auto (texto)
  height_pt    double precision,
  rotation     double precision NOT NULL DEFAULT 0,
  z_index      integer NOT NULL DEFAULT 0,
  style        jsonb NOT NULL DEFAULT '{}'::jsonb,    -- fontFamily, color, align, etc.
  condition    jsonb,                                 -- reservado p/ lógica condicional futura
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_template_elements_template_page
  ON document_template_elements(template_id, page_number);
CREATE INDEX IF NOT EXISTS idx_template_elements_tag
  ON document_template_elements(tag_id);


-- ───────────────────────────────────────────────────────────────────────────
-- 4. DOCUMENTOS GERADOS (histórico por cliente + mapeamento usado)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_generated_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  template_id    uuid NOT NULL REFERENCES document_templates(id) ON DELETE RESTRICT,
  storage_path   text NOT NULL,                       -- document-generated/{client_id}/{uuid}.pdf
  file_name      text NOT NULL,
  file_size      bigint,
  mappings       jsonb NOT NULL DEFAULT '[]'::jsonb,  -- ver estrutura em types.ts
  generated_at   timestamptz NOT NULL DEFAULT now(),
  generated_by   uuid REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_generated_docs_client
  ON client_generated_documents(client_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_generated_docs_template
  ON client_generated_documents(template_id, generated_at DESC);


-- ───────────────────────────────────────────────────────────────────────────
-- 5. Triggers de updated_at
-- ───────────────────────────────────────────────────────────────────────────
-- Reutilizamos/garantimos a função set_updated_at() (já usada em outras migrations).
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS document_tags_updated_at ON document_tags;
CREATE TRIGGER document_tags_updated_at
  BEFORE UPDATE ON document_tags
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS document_templates_updated_at ON document_templates;
CREATE TRIGGER document_templates_updated_at
  BEFORE UPDATE ON document_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS document_template_elements_updated_at ON document_template_elements;
CREATE TRIGGER document_template_elements_updated_at
  BEFORE UPDATE ON document_template_elements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ───────────────────────────────────────────────────────────────────────────
-- 6. Row Level Security
--    Nesta fase, apenas administradores têm acesso. A exposição de documentos
--    gerados para o cliente (via token do portal) será adicionada depois,
--    quando a aba "Documentos" do cliente entrar em cena.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE document_tags                ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_templates           ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_template_elements   ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_generated_documents   ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'document_tags' AND policyname = 'Admins manage document_tags') THEN
    EXECUTE $p$
      CREATE POLICY "Admins manage document_tags" ON document_tags FOR ALL
        USING (auth.uid() IN (SELECT id FROM admin_users))
        WITH CHECK (auth.uid() IN (SELECT id FROM admin_users))
    $p$;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'document_templates' AND policyname = 'Admins manage document_templates') THEN
    EXECUTE $p$
      CREATE POLICY "Admins manage document_templates" ON document_templates FOR ALL
        USING (auth.uid() IN (SELECT id FROM admin_users))
        WITH CHECK (auth.uid() IN (SELECT id FROM admin_users))
    $p$;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'document_template_elements' AND policyname = 'Admins manage document_template_elements') THEN
    EXECUTE $p$
      CREATE POLICY "Admins manage document_template_elements" ON document_template_elements FOR ALL
        USING (auth.uid() IN (SELECT id FROM admin_users))
        WITH CHECK (auth.uid() IN (SELECT id FROM admin_users))
    $p$;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'client_generated_documents' AND policyname = 'Admins manage client_generated_documents') THEN
    EXECUTE $p$
      CREATE POLICY "Admins manage client_generated_documents" ON client_generated_documents FOR ALL
        USING (auth.uid() IN (SELECT id FROM admin_users))
        WITH CHECK (auth.uid() IN (SELECT id FROM admin_users))
    $p$;
  END IF;
END $$;


-- ───────────────────────────────────────────────────────────────────────────
-- 7. Buckets de Storage
--    • document-templates : PDFs base (privado)
--    • document-fonts     : TTF/OTF usados no editor e na geração (público p/ leitura)
--    • document-generated : PDFs finais por cliente (privado)
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
  VALUES ('document-templates', 'document-templates', false)
  ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
  VALUES ('document-fonts', 'document-fonts', true)
  ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
  VALUES ('document-generated', 'document-generated', false)
  ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'objects' AND policyname = 'Admin full access to document-templates') THEN
    EXECUTE $p$
      CREATE POLICY "Admin full access to document-templates" ON storage.objects FOR ALL
        USING  (bucket_id = 'document-templates' AND auth.uid() IN (SELECT id FROM admin_users))
        WITH CHECK (bucket_id = 'document-templates' AND auth.uid() IN (SELECT id FROM admin_users))
    $p$;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'objects' AND policyname = 'Admin full access to document-generated') THEN
    EXECUTE $p$
      CREATE POLICY "Admin full access to document-generated" ON storage.objects FOR ALL
        USING  (bucket_id = 'document-generated' AND auth.uid() IN (SELECT id FROM admin_users))
        WITH CHECK (bucket_id = 'document-generated' AND auth.uid() IN (SELECT id FROM admin_users))
    $p$;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'objects' AND policyname = 'Admin manage document-fonts') THEN
    EXECUTE $p$
      CREATE POLICY "Admin manage document-fonts" ON storage.objects FOR ALL
        USING  (bucket_id = 'document-fonts' AND auth.uid() IN (SELECT id FROM admin_users))
        WITH CHECK (bucket_id = 'document-fonts' AND auth.uid() IN (SELECT id FROM admin_users))
    $p$;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'objects' AND policyname = 'Public read document-fonts') THEN
    EXECUTE $p$
      CREATE POLICY "Public read document-fonts" ON storage.objects FOR SELECT
        USING (bucket_id = 'document-fonts')
    $p$;
  END IF;
END $$;
CREATE TABLE client_tag_values (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tag_id      uuid NOT NULL REFERENCES document_tags(id) ON DELETE CASCADE,
  -- exatamente um dos dois abaixo é preenchido, conforme tag.type:
  text_value  text,
  photo_id    uuid REFERENCES client_photos(id) ON DELETE SET NULL,
  updated_at  timestamptz DEFAULT now(),
  UNIQUE(client_id, tag_id)
);

ALTER TABLE public.client_tag_values ADD COLUMN image_storage_path text;
ALTER TABLE public.client_tag_values ADD COLUMN image_size bigint;
ALTER TABLE public.client_tag_values ADD COLUMN image_mime text;

NOTIFY pgrst, 'reload schema';