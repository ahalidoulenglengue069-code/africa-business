DROP POLICY IF EXISTS public_verifie_codes_parrain ON public.profils_busaf;
DROP POLICY IF EXISTS fondateur_consulte_tous_les_profils ON public.profils_busaf;
CREATE POLICY fondateur_consulte_tous_les_profils
ON public.profils_busaf
FOR SELECT
TO authenticated
USING ((SELECT public.busaf_est_fondateur()));

REVOKE ALL ON FUNCTION public.verifier_code_parrain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verifier_code_parrain(text) TO anon, authenticated;
