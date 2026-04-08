/*
  # Remove Access Codes System

  1. Changes
    - Remove access_code column from users table
    - Update RLS policies to remove access code dependencies
    - Keep access_codes table for historical data but make it inactive

  2. Security
    - Maintain existing RLS policies for users
    - Simplify authentication flow
*/

-- Remove access_code column from users table
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'access_code'
  ) THEN
    ALTER TABLE users DROP COLUMN access_code;
  END IF;
END $$;

-- Update users table to ensure proper defaults
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'client';
ALTER TABLE users ALTER COLUMN is_active SET DEFAULT true;

-- The access_codes table will remain for historical purposes but won't be used
-- in the new authentication flow