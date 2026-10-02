-- The POS SQL database is the durable operational source for member-linked
-- sales. Remove the experimental cross-project delivery outbox. Every drop is
-- conditional, so environments that never received that experiment are safe.
drop trigger if exists queue_membership_sale_event_after_insert on public.sales;
drop function if exists public.membership_outbox_claim(text, integer);
drop function if exists public.queue_membership_sale_event();
drop table if exists public.membership_event_outbox;
