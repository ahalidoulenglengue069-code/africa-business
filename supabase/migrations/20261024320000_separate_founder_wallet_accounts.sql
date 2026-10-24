CREATE OR REPLACE FUNCTION public.busaf_solde_compte_fondateur(p_profil_id uuid, p_compte text)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_total numeric := 0;
  v_commissions numeric := 0;
  v_pending numeric := 0;
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Connexion requise.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profils_busaf caller
    WHERE caller.user_id = auth.uid()
      AND (caller.id = p_profil_id OR lower(trim(coalesce(caller.role, ''))) = 'fondateur')
  ) THEN
    RAISE EXCEPTION 'Accès refusé à ce portefeuille.';
  END IF;

  SELECT role INTO v_role FROM public.profils_busaf WHERE id = p_profil_id;
  IF v_role IS DISTINCT FROM 'fondateur' THEN
    IF p_compte NOT IN ('Compte Marché','Fonds BuSAF') THEN RETURN 0; END IF;
    SELECT coalesce(solde_disponible,0) INTO v_total
      FROM public.busaf_soldes_portefeuille WHERE profil_id=p_profil_id;
    SELECT coalesce(sum(montant),0) INTO v_pending
      FROM public.busaf_retraits
      WHERE profil_id=p_profil_id AND statut IN ('en_attente','approuve');
    RETURN greatest(coalesce(v_total,0)-coalesce(v_pending,0),0);
  END IF;

  SELECT coalesce(solde_disponible,0) INTO v_total
    FROM public.busaf_soldes_portefeuille WHERE profil_id=p_profil_id;

  -- Only the 7% direct-sponsor commission belongs to the founder referral account.
  -- The seller's 4.5% benefit is the founder's own gain and remains in BuSAF funds.
  SELECT coalesce(sum(montant),0) INTO v_commissions
    FROM public.busaf_commissions
    WHERE beneficiaire_id=p_profil_id
      AND statut='confirmee'
      AND type_commission='parrain_direct_7';

  SELECT coalesce(sum(montant),0) INTO v_pending
    FROM public.busaf_retraits
    WHERE profil_id=p_profil_id
      AND statut IN ('en_attente','approuve')
      AND compte = p_compte;

  IF p_compte='Commissions de parrainage' THEN
    RETURN greatest(v_commissions -
      coalesce((SELECT sum(montant) FROM public.busaf_retraits
        WHERE profil_id=p_profil_id AND compte='Commissions de parrainage' AND statut='paye'),0) - v_pending,0);
  ELSIF p_compte='Fonds BuSAF' THEN
    RETURN greatest(v_total -
      greatest(v_commissions -
        coalesce((SELECT sum(montant) FROM public.busaf_retraits
          WHERE profil_id=p_profil_id AND compte='Commissions de parrainage' AND statut='paye'),0),0) - v_pending,0);
  ELSE
    RETURN 0;
  END IF;
END;
$function$;
