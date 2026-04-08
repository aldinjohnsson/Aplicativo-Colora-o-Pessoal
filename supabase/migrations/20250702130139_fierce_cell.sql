/*
  # Add INSERT policy for user registration

  1. Security Changes
    - Add policy to allow authenticated users to insert their own user profile
    - This enables the sign-up process to create user records in the users table
    
  2. Policy Details
    - Allows INSERT operations for authenticated users
    - Restricts users to only insert records where the id matches their auth.uid()
    - This ensures users can only create their own profile, not others
*/

-- Add INSERT policy for user registration
CREATE POLICY "Users can insert own profile during registration"
  ON users
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);