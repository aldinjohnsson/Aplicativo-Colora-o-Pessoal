-- ══════════════════════════════════════════════════════════════════════════
-- ClientsManager — Gerador de Documento (Fase 1.5)
--
-- Adiciona o armazenamento de VALORES de tags por cliente:
--   • client_tag_values : para cada (cliente, tag) guarda texto ou imagem
--   • bucket client-tag-images : para imagens "avulsas" enviadas direto na tag
--
-- Depende da migration anterior (document_generator_phase1).
-- É idempotente: pode rodar várias vezes sem efeito colateral.
-- ══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. TABELA client_tag_values
--    UNIQUE(client_id, tag_id) — uma linha por par cliente/tag.
--    Campos mutuamente exclusivos conforme o tipo da tag:
--      • text_value        → tags do tipo 'text'
--      • photo_id          → tags do tipo 'image', apontando p/ client_photos
--      • image_storage_path→ tags do tipo 'image', upload avulso em bucket
--    A aplicação garante que no máximo uma das 3 está preenchida.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_tag_values (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tag_id              uuid NOT NULL REFERENCES document_tags(id) ON DELETE CASCADE,

  -- texto
  text_value          text,

  -- imagem: foto já existente na aba "Fotos" do cliente
  photo_id            uuid REFERENCES client_photos(id) ON DELETE SET NULL,

  -- imagem: upload avulso (fora da aba Fotos)
  image_storage_path  text,
  image_size          bigint,
  image_mime          text,

  updated_at          timestamptz NOT NULL DEFAULT now(),

  UNIQUE (client_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_client_tag_values_client ON client_tag_values(client_id);
CREATE INDEX IF NOT EXISTS idx_client_tag_values_tag    ON client_tag_values(tag_id);
CREATE INDEX IF NOT EXISTS idx_client_tag_values_photo  ON client_tag_values(photo_id)
  WHERE photo_id IS NOT NULL;


-- ───────────────────────────────────────────────────────────────────────────
-- 2. Trigger de updated_at
--    set_updated_at() já foi criada na migration anterior.
-- ───────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS client_tag_values_updated_at ON client_tag_values;
CREATE TRIGGER client_tag_values_updated_at
  BEFORE UPDATE ON client_tag_values
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ───────────────────────────────────────────────────────────────────────────
-- 3. Row Level Security
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE client_tag_values ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'client_tag_values'
                   AND policyname = 'Admins manage client_tag_values') THEN
    EXECUTE $p$
      CREATE POLICY "Admins manage client_tag_values" ON client_tag_values FOR ALL
        USING (auth.uid() IN (SELECT id FROM admin_users))
        WITH CHECK (auth.uid() IN (SELECT id FROM admin_users))
    $p$;
  END IF;
END $$;


-- ───────────────────────────────────────────────────────────────────────────
-- 4. Bucket para uploads avulsos (imagem ligada direto a uma tag)
--    Privado; o frontend usa URL assinada para preview.
--    Caminho esperado: {client_id}/{tag_id}/{timestamp}_{filename}
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
  VALUES ('client-tag-images', 'client-tag-images', false)
  ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'objects'
                   AND policyname = 'Admin full access to client-tag-images') THEN
    EXECUTE $p$
      CREATE POLICY "Admin full access to client-tag-images" ON storage.objects FOR ALL
        USING  (bucket_id = 'client-tag-images' AND auth.uid() IN (SELECT id FROM admin_users))
        WITH CHECK (bucket_id = 'client-tag-images' AND auth.uid() IN (SELECT id FROM admin_users))
    $p$;
  END IF;
END $$;


ALTER TABLE client_results ADD COLUMN IF NOT EXISTS chat_enabled boolean NOT NULL DEFAULT true;


ALTER TABLE clients
  DROP CONSTRAINT clients_status_check;

ALTER TABLE clients
  ADD CONSTRAINT clients_status_check
  CHECK (status IN (
    'awaiting_contract',
    'awaiting_form',
    'awaiting_photos',
    'photos_submitted',
    'in_analysis',
    'preparing_materials',
    'completed'
  ));

  -- Permite leitura pública dos arquivos de resultado
-- (acesso é controlado pelo token do portal, não por auth)
CREATE POLICY "Portal can read result files"
ON client_result_files
FOR SELECT
USING (true);

ALTER TABLE clients
DROP CONSTRAINT clients_status_check;

ALTER TABLE clients
ADD CONSTRAINT clients_status_check
CHECK (status IN (
  'awaiting_contract',
  'awaiting_form',
  'awaiting_photos',
  'photos_submitted',
  'in_analysis',
  'preparing_materials',
  'validating_materials',
  'completed'
));