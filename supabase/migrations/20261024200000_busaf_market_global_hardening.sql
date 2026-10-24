-- BuSAF global hardening: digital-only catalogue, pending purchase inserts,
-- and server-authoritative Partner progression.
-- Existing product/sales rows are not deleted or rewritten.

CREATE OR REPLACE FUNCTION public.busaf_progression_ventes()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile_id uuid;
  v_month bigint := 0;
  v_total bigint := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Connexion requise.';
  END IF;

  SELECT p.id INTO v_profile_id
  FROM public.profils_busaf AS p
  WHERE p.user_id = auth.uid()
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Profil BuSAF introuvable.';
  END IF;

  SELECT
    count(*) FILTER (
      WHERE COALESCE(v.date_vente, v.created_at) >= date_trunc('month', now())
        AND COALESCE(v.date_vente, v.created_at) < date_trunc('month', now()) + interval '1 month'
    ),
    count(*)
  INTO v_month, v_total
  FROM public.ventes AS v
  JOIN public.produits AS p ON p.id = v.produit_id
  WHERE v.vendeur_id = v_profile_id
    AND lower(COALESCE(v.statut, '')) IN (
      'confirmee', 'confirmée', 'confirme', 'confirmé', 'validee', 'validée',
      'terminee', 'terminée', 'completed', 'complete', 'success', 'paid'
    )
    AND lower(COALESCE(p.type_produit, '')) = 'digital';

  RETURN jsonb_build_object('mois', COALESCE(v_month, 0), 'total', COALESCE(v_total, 0));
END;
$function$;
REVOKE ALL ON FUNCTION public.busaf_progression_ventes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.busaf_progression_ventes() FROM anon;
GRANT EXECUTE ON FUNCTION public.busaf_progression_ventes() TO authenticated;

DROP POLICY IF EXISTS membre_cree_achat_marche ON public.ventes;
CREATE POLICY membre_cree_achat_marche
ON public.ventes
FOR INSERT
TO authenticated
WITH CHECK (
  acheteur_id = public.mon_profil_busaf_id()
  AND lower(coalesce(statut, '')) IN ('en_attente', 'pending')
  AND EXISTS (
    SELECT 1
    FROM public.produits AS p
    WHERE p.id = ventes.produit_id
      AND lower(coalesce(p.type_produit, '')) = 'digital'
      AND p.prix = ventes.montant
  )
);

DROP POLICY IF EXISTS marche_produits_visibles ON public.produits;
CREATE POLICY marche_produits_visibles
ON public.produits
FOR SELECT
TO authenticated
USING (
  lower(coalesce(type_produit, '')) = 'digital'
  AND lower(coalesce(nom, '')) NOT LIKE '%test%'
);

DROP POLICY IF EXISTS marche_produits_visibles_public ON public.produits;
CREATE POLICY marche_produits_visibles_public
ON public.produits
FOR SELECT
TO anon
USING (
  lower(coalesce(type_produit, '')) = 'digital'
  AND lower(coalesce(nom, '')) NOT LIKE '%test%'
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
    WHERE p.user_id = auth.uid()
      AND lower(trim(coalesce(p.role, ''))) = 'fondateur'
      AND p.id = produits.createur_id
  )
);

DROP POLICY IF EXISTS "Fondateur peut modifier produits" ON public.produits;
DROP POLICY IF EXISTS fondateur_modifie_produit_marche ON public.produits;
CREATE POLICY fondateur_modifie_produit_marche
ON public.produits
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profils_busaf AS p
    WHERE p.user_id = auth.uid()
      AND lower(trim(coalesce(p.role, ''))) = 'fondateur'
  )
)
WITH CHECK (lower(coalesce(type_produit, '')) = 'digital');
