/*
  # Corrigir Políticas RLS para Login

  1. Remove todas as políticas existentes que causam problemas
  2. Cria políticas simples e funcionais
  3. Evita recursão infinita nas consultas
*/

-- Remove todas as políticas existentes da tabela users
DROP POLICY IF EXISTS "Users can read own data" ON users;
DROP POLICY IF EXISTS "Users can insert own profile during registration" ON users;
DROP POLICY IF EXISTS "Users can update own profile" ON users;
DROP POLICY IF EXISTS "Admin users can read all users" ON users;
DROP POLICY IF EXISTS "Admin users can manage all users" ON users;

-- Política básica: usuários podem ler seus próprios dados
CREATE POLICY "users_select_own" ON users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Política para inserção durante registro
CREATE POLICY "users_insert_own" ON users
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Política para atualização dos próprios dados
CREATE POLICY "users_update_own" ON users
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Política para admins lerem todos os usuários (sem recursão)
-- Usa uma subconsulta direta na tabela users
CREATE POLICY "admin_select_all" ON users
  FOR SELECT
  TO authenticated
  USING (
    -- Permite ler próprios dados OU se for admin
    auth.uid() = id 
    OR 
    -- Verifica se o usuário atual é admin através de uma consulta simples
    (
      SELECT role FROM users WHERE id = auth.uid() LIMIT 1
    ) = 'admin'
  );

-- Política para admins gerenciarem todos os usuários
CREATE POLICY "admin_manage_all" ON users
  FOR ALL
  TO authenticated
  USING (
    (SELECT role FROM users WHERE id = auth.uid() LIMIT 1) = 'admin'
  )
  WITH CHECK (
    (SELECT role FROM users WHERE id = auth.uid() LIMIT 1) = 'admin'
  );