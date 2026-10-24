DROP POLICY IF EXISTS "Utilisateurs connectés - upload photos marché" ON storage.objects;
CREATE POLICY "Utilisateurs connectés - upload photos marché"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='marche' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);

DROP POLICY IF EXISTS "Utilisateurs connectés - modification photos marché" ON storage.objects;
CREATE POLICY "Utilisateurs connectés - modification photos marché"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id='marche' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text)
WITH CHECK (bucket_id='marche' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);
