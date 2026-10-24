-- Commission attribution follows ventes.vendeur_id.
-- Direct purchase rows remain attributed to produits.createur_id via busaf_sync_vendeur_vente.
CREATE OR REPLACE FUNCTION public.busaf_creer_commissions_vente_confirmee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_vendeur uuid;
  v_parrain uuid;
  v_type text;
  v_montant numeric;
BEGIN
  IF lower(coalesce(NEW.statut,'')) NOT IN (
    'confirmee','confirmée','confirme','confirmé','validee','validée',
    'valide','terminee','terminée','completed','complete','success','paid','successful'
  ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND lower(coalesce(OLD.statut,'')) IN (
    'confirmee','confirmée','confirme','confirmé','validee','validée',
    'valide','terminee','terminée','completed','complete','success','paid','successful'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(NEW.vendeur_id, p.createur_id),
         p.type_produit,
         greatest(coalesce(NEW.montant,0),0)
    INTO v_vendeur, v_type, v_montant
    FROM public.produits AS p
   WHERE p.id = NEW.produit_id;

  IF lower(coalesce(v_type,'')) <> 'digital' OR v_montant <= 0 OR v_vendeur IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.busaf_commissions
    (vente_id, beneficiaire_id, type_commission, taux, montant)
  VALUES
    (NEW.id, v_vendeur, 'benefice_vendeur_4_5', 4.5, round(v_montant * 0.045, 2))
  ON CONFLICT (vente_id, beneficiaire_id, type_commission) DO NOTHING;

  SELECT parrain_id INTO v_parrain
  FROM public.profils_busaf
  WHERE id = v_vendeur;

  IF v_parrain IS NOT NULL AND v_parrain <> v_vendeur THEN
    INSERT INTO public.busaf_commissions
      (vente_id, beneficiaire_id, type_commission, taux, montant)
    VALUES
      (NEW.id, v_parrain, 'parrain_direct_7', 7, round(v_montant * 0.07, 2))
    ON CONFLICT (vente_id, beneficiaire_id, type_commission) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;
