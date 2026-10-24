DROP POLICY IF EXISTS "Utilisateurs connectés - upload photos" ON storage.objects;
DROP POLICY IF EXISTS "Utilisateurs connectés - upload photos 1twvzjr_0" ON storage.objects;
DROP POLICY IF EXISTS membre_ajoute_sa_photo ON storage.objects;
DROP POLICY IF EXISTS membre_modifie_sa_photo ON storage.objects;
-- Keep profils_upload_own, profils_update_own and membre_supprime_sa_photo; all restrict the first folder to auth.uid().
-- Founder product images remain restricted to the profils/marche/{auth.uid}/ path.
