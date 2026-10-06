-- A row version is a per-record revision counter. New products must begin at
-- revision 1 so an offline insert can never be mistaken for an unversioned row.
ALTER TABLE public.products
  ALTER COLUMN row_version SET DEFAULT 1;

-- Version zero was the former insert default. Advancing it is monotonic and
-- lets the existing update trigger publish revision 1 to the sync feed.
UPDATE public.products
SET row_version = 1
WHERE row_version < 1;
