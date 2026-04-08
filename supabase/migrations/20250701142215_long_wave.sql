/*
  # Gerar código de acesso para usuário

  1. Novo código de acesso
    - Código único: USER2025
    - Status: disponível para uso
    - Criado especificamente para cadastro inicial
*/

-- Inserir código de acesso específico para você
INSERT INTO access_codes (code) VALUES ('USER2025')
ON CONFLICT (code) DO NOTHING;

-- Verificar se o código foi criado
SELECT code, is_used, created_at 
FROM access_codes 
WHERE code = 'USER2025';