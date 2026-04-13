-- ============================================================
-- MIGRAÇÃO: Login do cliente por email + data de nascimento
-- ============================================================

-- 1. Adicionar coluna birth_date na tabela clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS birth_date date;

-- 2. Função RPC: busca o token do cliente pelo email + data de nascimento
CREATE OR REPLACE FUNCTION get_client_token_by_credentials(
  p_email text,
  p_birth_date date
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_client clients%ROWTYPE;
BEGIN
  SELECT * INTO v_client
  FROM clients
  WHERE lower(trim(email)) = lower(trim(p_email))
    AND birth_date = p_birth_date
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Credenciais inválidas. Verifique seu e-mail e data de nascimento.');
  END IF;

  RETURN json_build_object('token', v_client.token);
END;
$$;
-- Adicionar a coluna que está faltando
ALTER TABLE client_photos ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES plan_photo_categories(id) ON DELETE SET NULL;

-- 1. Dropar todas as constraints e views dependentes
ALTER TABLE client_attachments DROP CONSTRAINT IF EXISTS client_attachments_client_id_fkey;
ALTER TABLE client_photos DROP CONSTRAINT IF EXISTS client_photos_client_id_fkey;
DROP VIEW IF EXISTS client_summary;
DROP VIEW IF EXISTS v_clients_summary;

-- 2. Converter as três tabelas
ALTER TABLE client_data
ALTER COLUMN client_id TYPE uuid USING client_id::uuid;

ALTER TABLE client_photos
ALTER COLUMN client_id TYPE uuid USING client_id::uuid;

ALTER TABLE client_attachments
ALTER COLUMN client_id TYPE uuid USING client_id::uuid;

-- 3. Recriar FKs
ALTER TABLE client_photos
ADD CONSTRAINT client_photos_client_id_fkey
FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

ALTER TABLE client_attachments
ADD CONSTRAINT client_attachments_client_id_fkey
FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

-- 4. Recriar views
CREATE OR REPLACE VIEW client_summary AS
SELECT cd.client_id, cd.full_name, cd.email, cd.phone, cd.status, cd.created_at, cd.completed_at,
    count(DISTINCT cp.id) AS photo_count,
    count(DISTINCT ca.id) AS attachment_count,
    COALESCE(sum(cp.photo_size), 0::numeric) AS total_photo_size,
    COALESCE(sum(ca.attachment_size), 0::numeric) AS total_attachment_size
FROM client_data cd
LEFT JOIN client_photos cp ON cd.client_id = cp.client_id
LEFT JOIN client_attachments ca ON cd.client_id = ca.client_id
GROUP BY cd.client_id, cd.full_name, cd.email, cd.phone, cd.status, cd.created_at, cd.completed_at
ORDER BY cd.completed_at DESC;

CREATE OR REPLACE VIEW v_clients_summary AS
SELECT cd.id, cd.client_id, cd.full_name, cd.email, cd.phone, cd.status, cd.completed_at,
    count(DISTINCT cp.id) AS total_photos,
    count(DISTINCT ca.id) AS total_attachments,
    sum(DISTINCT cp.photo_size) AS total_photos_size,
    sum(DISTINCT ca.attachment_size) AS total_attachments_size
FROM client_data cd
LEFT JOIN client_photos cp ON cd.client_id = cp.client_id
LEFT JOIN client_attachments ca ON cd.client_id = ca.client_id
GROUP BY cd.id, cd.client_id, cd.full_name, cd.email, cd.phone, cd.status, cd.completed_at
ORDER BY cd.completed_at DESC;


-- Liberar acesso anônimo às funções do portal do cliente
GRANT EXECUTE ON FUNCTION get_client_portal(text) TO anon;
GRANT EXECUTE ON FUNCTION sign_client_contract(text) TO anon;
GRANT EXECUTE ON FUNCTION submit_client_form(text, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION save_client_photo(text, text, text, bigint, text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION finalize_client_photos(text, date, timestamptz) TO anon;
GRANT EXECUTE ON FUNCTION get_result_file_url(text, text) TO anon;