/*
  # Fix infinite recursion in users table RLS policies

  1. Problem
    - Current policies on users table cause infinite recursion
    - "Admins can read all users" policy queries users table from within itself
    - This creates a circular dependency during policy evaluation

  2. Solution
    - Drop existing problematic policies
    - Create simplified policies that don't reference the users table recursively
    - Use auth.jwt() claims for role checking instead of querying users table
    - Maintain security while avoiding recursion

  3. Changes
    - Remove recursive admin policy
    - Simplify user policies to use direct auth.uid() comparisons
    - Add new admin policy using JWT claims (if available)
*/

-- Drop existing policies that cause recursion
DROP POLICY IF EXISTS "Admins can read all users" ON users;
DROP POLICY IF EXISTS "Users can read own data" ON users;
DROP POLICY IF EXISTS "Users can update own profile" ON users;
DROP POLICY IF EXISTS "Users can insert own profile during registration" ON users;

-- Create simplified policies without recursion
CREATE POLICY "Users can read own data"
  ON users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON users
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile during registration"
  ON users
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- For admin access, we'll handle this in the application layer
-- or use a different approach that doesn't cause recursion
-- This policy allows reading if the user's role in their own record is 'admin'
-- but only after they can read their own record first
CREATE POLICY "Admin users can read all users"
  ON users
  FOR SELECT
  TO authenticated
  USING (
    -- First check if user can read their own record
    auth.uid() = id 
    OR 
    -- Then check if the requesting user has admin role
    -- This uses a different approach to avoid recursion
    EXISTS (
      SELECT 1 FROM auth.users 
      WHERE auth.users.id = auth.uid() 
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );