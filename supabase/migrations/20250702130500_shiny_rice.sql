/*
  # Fix Users Table RLS Policies

  1. Security Updates
    - Drop existing restrictive policies that prevent proper user registration
    - Add new policies that allow authenticated users to manage their own profiles
    - Ensure admin users can still manage all users
    - Allow proper user registration flow

  2. Policy Changes
    - Enable authenticated users to insert their own profile during registration
    - Allow users to read and update their own data
    - Maintain admin access to all user data
*/

-- Drop existing policies to recreate them with proper permissions
DROP POLICY IF EXISTS "Admin users can read all users" ON users;
DROP POLICY IF EXISTS "Users can insert own profile during registration" ON users;
DROP POLICY IF EXISTS "Users can read own data" ON users;
DROP POLICY IF EXISTS "Users can update own profile" ON users;

-- Policy for authenticated users to read their own data
CREATE POLICY "Users can read own data"
  ON users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Policy for authenticated users to insert their own profile during registration
CREATE POLICY "Users can insert own profile during registration"
  ON users
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Policy for authenticated users to update their own profile
CREATE POLICY "Users can update own profile"
  ON users
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Policy for admin users to read all users
CREATE POLICY "Admin users can read all users"
  ON users
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id OR 
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Policy for admin users to manage all users
CREATE POLICY "Admin users can manage all users"
  ON users
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );