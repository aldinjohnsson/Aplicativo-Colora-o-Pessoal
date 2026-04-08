/*
  # Create Admin User

  This creates the first admin user. You'll need to:
  1. Replace 'admin@exemplo.com' with your actual email
  2. Create an account with this email through the auth system
  3. Run this migration to set the role to admin
*/

-- First, you need to sign up with your email through the application
-- Then run this to make that user an admin:

-- UPDATE users 
-- SET role = 'admin' 
-- WHERE email = 'admin@exemplo.com';

-- For now, we'll just ensure the admin role exists in the check constraint
-- The actual admin user will be created when you first sign up