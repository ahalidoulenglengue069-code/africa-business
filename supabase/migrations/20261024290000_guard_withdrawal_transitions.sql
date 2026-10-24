CREATE OR REPLACE FUNCTION public.busaf_guard_retrait_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_founder_id uuid;
BEGIN
  IF NEW.profil_id IS DISTINCT FROM OLD.profil_id
     OR NEW.montant IS DISTINCT FROM OLD.montant
     OR NEW.numero_mobile_money IS DISTINCT FROM OLD.numero_mobile_money
     OR NEW.operateur IS DISTINCT FROM OLD.operateur
     OR NEW.compte IS DISTINCT FROM OLD.compte
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Les informations financières d’une demande de retrait sont immuables.';
  END IF;

  IF NEW.statut IS DISTINCT FROM OLD.statut THEN
    IF OLD.statut = 'en_attente' AND NEW.statut NOT IN ('approuve','refuse') THEN
      RAISE EXCEPTION 'Une demande en attente doit être approuvée ou refusée avant le paiement.';
    ELSIF OLD.statut = 'approuve' AND NEW.statut NOT IN ('paye','refuse') THEN
      RAISE EXCEPTION 'Une demande approuvée peut être payée ou refusée.';
    ELSIF OLD.statut IN ('refuse','paye') THEN
      RAISE EXCEPTION 'Une demande terminée ne peut plus être modifiée.';
    END IF;

    SELECT id INTO v_founder_id
    FROM public.profils_busaf
    WHERE user_id = auth.uid()
      AND lower(trim(coalesce(role,''))) = 'fondateur'
    LIMIT 1;

    IF v_founder_id IS NULL THEN
      RAISE EXCEPTION 'Action réservée au fondateur.';
    END IF;
    NEW.traite_par := v_founder_id;
    NEW.traite_le := now();
  END IF;

  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS busaf_guard_retrait_update ON public.busaf_retraits;
CREATE TRIGGER busaf_guard_retrait_update
BEFORE UPDATE ON public.busaf_retraits
FOR EACH ROW EXECUTE FUNCTION public.busaf_guard_retrait_update();
REVOKE ALL ON FUNCTION public.busaf_guard_retrait_update() FROM PUBLIC, anon, authenticated;
