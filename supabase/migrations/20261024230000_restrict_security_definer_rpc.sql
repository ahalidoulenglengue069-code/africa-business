-- Restrict client-callable RPC permissions for trigger/admin/test helpers.
REVOKE ALL ON FUNCTION public.busaf_creer_commissions_vente_confirmee() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.busaf_event_vente() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.busaf_sync_vendeur_vente() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.corriger_acheteur_vente() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.test_achat_marche(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.test_param_busaf(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verifier_achat_busaf(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.test_busaf() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.test_busaf_fonction() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.test_finalisation_busaf() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.busaf_est_fondateur() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.busaf_est_fondateur() TO authenticated;
REVOKE ALL ON FUNCTION public.mon_profil_busaf_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mon_profil_busaf_id() TO authenticated;
REVOKE ALL ON FUNCTION public.verifier_code_parrain(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verifier_code_parrain(text) TO authenticated;
REVOKE ALL ON FUNCTION public.creer_profil_busaf() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.creer_profil_busaf() TO authenticated;
