-- Bind a phone-approved terminal row to the sealed proof contained in the
-- scanned PC QR. Existing unbound activation codes remain compatible.
-- This migration changes no rows and deletes no data.

create or replace function public.terminal_token_claim(
  p_token_id uuid,
  p_device text default null,
  p_proof_hash text default null,
  p_platform text default null,
  p_os text default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  t public.terminal_tokens%rowtype;
  claimed boolean;
begin
  select * into t from public.terminal_tokens where id = p_token_id for update;
  if not found then return false; end if;

  if t.status = 'revoked' or t.revoked_at is not null then
    raise exception 'TERMINAL_TOKEN_REVOKED';
  end if;
  if btrim(coalesce(t.location_id, '')) = '' then
    raise exception 'TERMINAL_BRANCH_REQUIRED';
  end if;
  if exists (
    select 1 from public.stores s
     where s.id = t.location_id
       and (s.deleted_at is not null or s.archived_at is not null or s.is_active is false)
  ) then
    raise exception 'TERMINAL_BRANCH_INACTIVE';
  end if;
  if nullif(btrim(coalesce(p_proof_hash, '')), '') is null then
    raise exception 'TERMINAL_DEVICE_PROOF_REQUIRED';
  end if;

  -- A phone-scanned pairing approval writes claim_proof before the terminal
  -- claims. Only the device whose QR supplied that proof may consume it.
  if nullif(btrim(coalesce(t.claim_proof, '')), '') is not null
     and t.claim_proof <> p_proof_hash then
    raise exception 'TERMINAL_DEVICE_PROOF_MISMATCH';
  end if;

  if t.status <> 'active' or t.claimed_at is not null then
    if coalesce(t.claim_proof, t.claimed_proof_hash) = p_proof_hash then
      update public.terminal_tokens set last_seen_at = now() where id = p_token_id;
      return true;
    end if;
    return false;
  end if;
  if t.expires_at is not null and t.expires_at < now() then
    raise exception 'TERMINAL_TOKEN_EXPIRED';
  end if;
  if (
    (t.platform = 'mobile' and p_platform = 'android') or
    (t.platform = 'pc' and p_platform = 'electron')
  ) is not true then
    raise exception 'TERMINAL_PLATFORM_MISMATCH';
  end if;

  update public.terminal_tokens
     set status = 'used',
         claimed_by_device = left(coalesce(p_device, claimed_by_device), 120),
         claim_proof = p_proof_hash,
         claimed_proof_hash = p_proof_hash,
         claimed_platform = coalesce(nullif(btrim(coalesce(p_platform, '')), ''), claimed_platform),
         claimed_os = coalesce(nullif(btrim(coalesce(p_os, '')), ''), claimed_os),
         is_claimed = true,
         claimed_at = now(),
         activated_at = coalesce(activated_at, now()),
         last_seen_at = now()
   where id = p_token_id and status = 'active' and claimed_at is null
   returning true into claimed;

  return coalesce(claimed, false);
end;
$fn$;

revoke all on function public.terminal_token_claim(uuid, text, text, text, text) from public;
grant execute on function public.terminal_token_claim(uuid, text, text, text, text)
  to anon, authenticated, service_role;

comment on function public.terminal_token_claim(uuid, text, text, text, text) is
  'Single-use terminal claim; pre-bound phone pairings require the sealed proof scanned from that device.';

notify pgrst, 'reload schema';
