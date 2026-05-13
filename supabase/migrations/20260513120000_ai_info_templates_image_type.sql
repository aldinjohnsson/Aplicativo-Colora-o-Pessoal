-- ══════════════════════════════════════════════════════════════════════════
-- Tags de "Informações da Análise" — suporte a tags do tipo IMAGEM
--
-- Antes:
--   ai_info_templates.options : jsonb (array de strings)
--   Ex: ["Verão Suave", "Inverno Frio"]
--
-- Agora (text continua igual; image é novo):
--   ai_info_templates.type    : 'text' (default) | 'image'
--   ai_info_templates.options : jsonb
--      - quando type='text' : array de strings        ["Verão Suave", ...]
--      - quando type='image': array de objetos        [{ "label":"Pele negra",
--                                                       "imagePath":"<tag_id>/abc.jpg" }, ...]
--
-- O VALOR salvo em clients.ai_info_tags continua sendo `{ templateId, name, value }`
-- onde `value` é a label da opção escolhida. Assim o system prompt do Gemini
-- e tudo que já consome essas tags não muda.
--
-- Idempotente — pode rodar várias vezes.
-- ══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. Coluna `type` em ai_info_templates
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE ai_info_templates
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'text';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_info_templates_type_check'
  ) THEN
    ALTER TABLE ai_info_templates
      ADD CONSTRAINT ai_info_templates_type_check
      CHECK (type IN ('text', 'image'));
  END IF;
END $$;


-- ───────────────────────────────────────────────────────────────────────────
-- 2. Bucket público p/ imagens-catálogo das opções
--    Caminho esperado: {template_id}/{timestamp}_{slug}.{ext}
--    Leitura pública (são imagens-catálogo, não dados sensíveis); escrita só admin.
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
  VALUES ('ai-tag-option-images', 'ai-tag-option-images', true)
  ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'objects'
                   AND policyname = 'Admin manage ai-tag-option-images') THEN
    EXECUTE $p$
      CREATE POLICY "Admin manage ai-tag-option-images" ON storage.objects FOR ALL
        USING  (bucket_id = 'ai-tag-option-images' AND auth.uid() IN (SELECT id FROM admin_users))
        WITH CHECK (bucket_id = 'ai-tag-option-images' AND auth.uid() IN (SELECT id FROM admin_users))
    $p$;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'objects'
                   AND policyname = 'Public read ai-tag-option-images') THEN
    EXECUTE $p$
      CREATE POLICY "Public read ai-tag-option-images" ON storage.objects FOR SELECT
        USING (bucket_id = 'ai-tag-option-images')
    $p$;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
