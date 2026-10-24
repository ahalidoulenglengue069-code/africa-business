DROP POLICY IF EXISTS "Founder read withdrawal requests" ON public.busaf_retraits;
DROP POLICY IF EXISTS "Members read own withdrawal requests" ON public.busaf_retraits;
CREATE POLICY busaf_retraits_read_own_or_founder
ON public.busaf_retraits
FOR SELECT
TO authenticated
USING (
  profil_id = (SELECT public.mon_profil_busaf_id())
  OR (SELECT public.busaf_est_fondateur())
);
