-- The member portal reads and writes through authenticated, UID-bound RPCs.
-- Keep the underlying tables unreachable even if a future default grant is
-- widened, and make the intentional RPC-only boundary explicit to the linter.

revoke all on public.members from public, anon, authenticated;
revoke all on public.membership_events from public, anon, authenticated;
revoke all on public.membership_tiers from public, anon, authenticated;

drop policy if exists members_no_direct_access on public.members;
create policy members_no_direct_access on public.members
  for all to anon, authenticated using (false) with check (false);

drop policy if exists membership_events_no_direct_access on public.membership_events;
create policy membership_events_no_direct_access on public.membership_events
  for all to anon, authenticated using (false) with check (false);

drop policy if exists membership_tiers_no_direct_access on public.membership_tiers;
create policy membership_tiers_no_direct_access on public.membership_tiers
  for all to anon, authenticated using (false) with check (false);

notify pgrst, 'reload schema';
