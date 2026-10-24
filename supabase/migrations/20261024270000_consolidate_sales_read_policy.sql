DROP POLICY IF EXISTS fondateur_consulte_toutes_les_ventes ON public.ventes;
DROP POLICY IF EXISTS membre_consulte_ses_ventes ON public.ventes;
CREATE POLICY ventes_consultation_autorisee
ON public.ventes
FOR SELECT
TO authenticated
USING (
  acheteur_id = (SELECT public.mon_profil_busaf_id())
  OR vendeur_id = (SELECT public.mon_profil_busaf_id())
  OR (SELECT public.busaf_est_fondateur())
);
