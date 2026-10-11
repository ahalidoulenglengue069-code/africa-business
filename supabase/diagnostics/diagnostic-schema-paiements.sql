-- BuSAF : diagnostic LECTURE SEULE du schéma des paiements.
-- À exécuter dans Supabase > SQL Editor > New query.
-- Ce script ne modifie aucune donnée et ne crée/altère aucune table.

-- 1) Colonnes réelles des tables utilisées par le paiement.
select
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'ventes',
    'produits',
    'profils_busaf',
    'stocks',
    'stock',
    'commissions',
    'portefeuille',
    'portefeuilles',
    'achats_marche'
  )
order by table_name, ordinal_position;

-- 2) Contraintes et valeurs autorisées (dont les statuts de ventes).
select
  c.relname as table_name,
  con.conname as constraint_name,
  con.contype as constraint_type,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'ventes','produits','profils_busaf','stocks','stock',
    'commissions','portefeuille','portefeuilles','achats_marche'
  )
order by c.relname, con.contype, con.conname;

-- 3) Déclencheurs existants sur ventes/stock/commissions.
select
  event_object_table as table_name,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
from information_schema.triggers
where trigger_schema = 'public'
  and event_object_table in (
    'ventes','produits','stocks','stock','commissions','portefeuille',
    'portefeuilles','achats_marche'
  )
order by event_object_table, trigger_name, event_manipulation;

-- 4) Fonctions RPC candidates liées aux ventes/commissions/stock.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as return_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    p.proname ilike '%vente%'
    or p.proname ilike '%achat%'
    or p.proname ilike '%commission%'
    or p.proname ilike '%stock%'
    or p.proname ilike '%paiement%'
  )
order by p.proname;
