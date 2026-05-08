-- Create the bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('child-avatars', 'child-avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Policy to allow authenticated users to upload their own avatars 
-- (Assuming the path starts with their user ID)
CREATE POLICY "Allow authenticated users to upload avatars" 
ON storage.objects FOR INSERT 
TO authenticated 
WITH CHECK (bucket_id = 'child-avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Policy to allow authenticated users to update their own avatars
CREATE POLICY "Allow authenticated users to update their own avatars" 
ON storage.objects FOR UPDATE 
TO authenticated 
USING (bucket_id = 'child-avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Policy to allow anyone to view avatars (public bucket)
CREATE POLICY "Allow public to view avatars" 
ON storage.objects FOR SELECT 
TO public 
USING (bucket_id = 'child-avatars');

-- Policy to allow users to delete their own avatars
CREATE POLICY "Allow users to delete their own avatars" 
ON storage.objects FOR DELETE 
TO authenticated 
USING (bucket_id = 'child-avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
