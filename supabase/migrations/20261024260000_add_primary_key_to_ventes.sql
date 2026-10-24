-- ventes.id was verified non-null and unique before this migration.
ALTER TABLE public.ventes ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.ventes ADD CONSTRAINT ventes_pkey PRIMARY KEY (id);
