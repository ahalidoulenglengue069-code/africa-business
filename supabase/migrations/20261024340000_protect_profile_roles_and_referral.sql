CREATE OR REPLACE FUNCTION public.busaf_guard_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.parrain_id IS DISTINCT FROM OLD.parrain_id
     OR NEW.code_parrain IS DISTINCT FROM OLD.code_parrain
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'L’identité, le parrain et le code de parrainage ne peuvent pas être modifiés.';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role AND NOT public.busaf_est_fondateur() THEN
    RAISE EXCEPTION 'Seul le fondateur peut modifier le rôle d’un membre.';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS busaf_guard_profile_update ON public.profils_busaf;
CREATE TRIGGER busaf_guard_profile_update
BEFORE UPDATE ON public.profils_busaf
FOR EACH ROW EXECUTE FUNCTION public.busaf_guard_profile_update();
REVOKE ALL ON FUNCTION public.busaf_guard_profile_update() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.busaf_guard_profile_update() TO authenticated;

DROP POLICY IF EXISTS "Membre peut modifier son profil" ON public.profils_busaf;
DROP POLICY IF EXISTS membre_modifie_son_profil ON public.profils_busaf;
DROP POLICY IF EXISTS profils_busaf_update_own_photo ON public.profils_busaf;
DROP POLICY IF EXISTS profils_busaf_update_own_profile ON public.profils_busaf;
CREATE POLICY profils_busaf_update_own_profile
ON public.profils_busaf FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS fondateur_modifie_profils_busaf ON public.profils_busaf;
CREATE POLICY fondateur_modifie_profils_busaf
ON public.profils_busaf FOR UPDATE TO authenticated
USING ((SELECT public.busaf_est_fondateur()))
WITH CHECK ((SELECT public.busaf_est_fondateur()));

DROP POLICY IF EXISTS membre_cree_profil_avec_parrain ON public.profils_busaf;
CREATE POLICY membre_cree_profil_avec_parrain
ON public.profils_busaf FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND role = 'membre'
  AND parrain_id IS NOT NULL
);
