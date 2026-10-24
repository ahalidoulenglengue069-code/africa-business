CREATE INDEX IF NOT EXISTS idx_ventes_acheteur_statut_created
  ON public.ventes (acheteur_id, statut, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ventes_vendeur_statut_date
  ON public.ventes (vendeur_id, statut, date_vente DESC);
CREATE INDEX IF NOT EXISTS idx_ventes_produit_id
  ON public.ventes (produit_id);
CREATE INDEX IF NOT EXISTS idx_profils_busaf_parrain_id
  ON public.profils_busaf (parrain_id);
CREATE INDEX IF NOT EXISTS idx_busaf_commissions_beneficiaire_statut_created
  ON public.busaf_commissions (beneficiaire_id, statut, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_busaf_retraits_profil_statut_compte
  ON public.busaf_retraits (profil_id, statut, compte);
CREATE INDEX IF NOT EXISTS idx_busaf_depots_profil_statut
  ON public.busaf_depots (profil_id, statut);
CREATE INDEX IF NOT EXISTS idx_busaf_transactions_portefeuille_portefeuille_id
  ON public.busaf_transactions_portefeuille (portefeuille_id);
