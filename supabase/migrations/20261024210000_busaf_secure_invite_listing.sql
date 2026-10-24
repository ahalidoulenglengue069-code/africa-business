-- Secure member-facing referral list: return names/roles/dates only, never invitee email addresses.
CREATE OR REPLACE FUNCTION public.busaf_mes_invites()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile_id uuid;
  v_result jsonb;
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

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', invited.id,
        'nom_complet', COALESCE(NULLIF(btrim(invited.nom_complet), ''), 'Membre BuSAF'),
        'role', invited.role,
        'created_at', invited.created_at
      ) ORDER BY invited.created_at DESC NULLS LAST
    ),
    '[]'::jsonb
  ) INTO v_result
  FROM public.profils_busaf AS invited
  WHERE invited.parrain_id = v_profile_id;

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.busaf_mes_invites() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.busaf_mes_invites() FROM anon;
GRANT EXECUTE ON FUNCTION public.busaf_mes_invites() TO authenticated;
