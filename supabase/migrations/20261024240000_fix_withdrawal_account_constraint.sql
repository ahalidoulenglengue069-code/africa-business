-- The withdrawal RPC supports these account names; the table constraint must match.
ALTER TABLE public.busaf_retraits
  DROP CONSTRAINT IF EXISTS busaf_retraits_compte_check;
ALTER TABLE public.busaf_retraits
  ADD CONSTRAINT busaf_retraits_compte_check
  CHECK (compte = ANY (ARRAY[
    'Compte Marché'::text,
    'Compte Boutique'::text,
    'Fonds BuSAF'::text,
    'Commissions de parrainage'::text
  ]));

-- This function is attached to auth.users as a trigger, not a client RPC.
REVOKE ALL ON FUNCTION public.creer_profil_busaf() FROM PUBLIC, anon, authenticated;
