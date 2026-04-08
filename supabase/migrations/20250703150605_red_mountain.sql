/*
  # Create Document Folders System

  1. New Tables
    - `document_folders` - Store document folder metadata with access control
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to users)
      - `folder_name` (text)
      - `access_token` (text, unique)
      - `access_password` (text)
      - `expires_at` (timestamptz)
      - `contract_uploaded` (boolean)
      - `form_uploaded` (boolean)
      - `photos_uploaded` (boolean)
      - `is_complete` (boolean)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on document_folders table
    - Add policies for user access and public sharing
    - Create storage bucket and policies for documents

  3. Storage
    - Create documents bucket for file storage
    - Set up proper access policies for document sharing
*/

-- Create document_folders table
CREATE TABLE IF NOT EXISTS document_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_name text NOT NULL,
  access_token text UNIQUE NOT NULL,
  access_password text NOT NULL,
  expires_at timestamptz NOT NULL,
  contract_uploaded boolean DEFAULT false NOT NULL,
  form_uploaded boolean DEFAULT false NOT NULL,
  photos_uploaded boolean DEFAULT false NOT NULL,
  is_complete boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_document_folders_user_id ON document_folders(user_id);
CREATE INDEX IF NOT EXISTS idx_document_folders_access_token ON document_folders(access_token);
CREATE INDEX IF NOT EXISTS idx_document_folders_expires_at ON document_folders(expires_at);

-- Enable Row Level Security
ALTER TABLE document_folders ENABLE ROW LEVEL SECURITY;

-- Policy for users to manage their own document folders
CREATE POLICY "Users can manage own document folders"
  ON document_folders
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Policy for public access via access token (for sharing documents)
CREATE POLICY "Public access via valid access token"
  ON document_folders
  FOR SELECT
  TO authenticated, anon
  USING (
    access_token IS NOT NULL 
    AND expires_at > now()
  );

-- Policy for admins to view all document folders
CREATE POLICY "Admins can view all document folders"
  ON document_folders
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'admin'
    )
  );

-- Create storage bucket for documents if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- Drop existing storage policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Users can upload to their own folders" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own documents" ON storage.objects;
DROP POLICY IF EXISTS "Public can view documents with valid access token" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own documents" ON storage.objects;

-- Storage policies for documents bucket
CREATE POLICY "Users can upload to their own folders"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'documents' 
    AND (storage.foldername(name))[1] IN (
      SELECT df.id::text 
      FROM document_folders df 
      WHERE df.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can view their own documents"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documents' 
    AND (
      (storage.foldername(name))[1] IN (
        SELECT df.id::text 
        FROM document_folders df 
        WHERE df.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM users 
        WHERE users.id = auth.uid() 
        AND users.role = 'admin'
      )
    )
  );

CREATE POLICY "Public can view documents with valid access token"
  ON storage.objects
  FOR SELECT
  TO authenticated, anon
  USING (
    bucket_id = 'documents' 
    AND (storage.foldername(name))[1] IN (
      SELECT df.id::text 
      FROM document_folders df 
      WHERE df.expires_at > now()
    )
  );

CREATE POLICY "Users can delete their own documents"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'documents' 
    AND (
      (storage.foldername(name))[1] IN (
        SELECT df.id::text 
        FROM document_folders df 
        WHERE df.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM users 
        WHERE users.id = auth.uid() 
        AND users.role = 'admin'
      )
    )
  );