DROP POLICY IF EXISTS membre_cree_achat_marche ON public.ventes;
CREATE POLICY membre_cree_achat_marche
ON public.ventes
FOR INSERT
TO authenticated
WITH CHECK (
  acheteur_id = (SELECT public.mon_profil_busaf_id())
  AND lower(coalesce(statut, '')) IN ('en_attente', 'pending')
  AND EXISTS (
    SELECT 1 FROM public.produits AS p
    WHERE p.id = ventes.produit_id
      AND lower(coalesce(p.type_produit, '')) = 'digital'
      AND p.prix = ventes.montant
  )
);

DROP POLICY IF EXISTS fondateur_ajoute_produit_marche ON public.produits;
CREATE POLICY fondateur_ajoute_produit_marche
ON public.produits
FOR INSERT
TO authenticated
WITH CHECK (
  lower(coalesce(type_produit, '')) = 'digital'
  AND EXISTS (
    SELECT 1 FROM public.profils_busaf AS p
    WHERE p.user_id = (SELECT auth.uid())
      AND lower(trim(coalesce(p.role, ''))) = 'fondateur'
      AND p.id = produits.createur_id
  )
);

DROP POLICY IF EXISTS fondateur_modifie_produit_marche ON public.produits;
CREATE POLICY fondateur_modifie_produit_marche
ON public.produits
FOR UPDATE
TO authenticated
USING ((SELECT public.busaf_est_fondateur()))
WITH CHECK (lower(coalesce(type_produit, '')) = 'digital');
