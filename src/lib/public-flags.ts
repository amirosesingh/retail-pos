/**
 * Small yes/no switches the public pages must be able to read without signing
 * in. They live in `public_flags` (anon readable, staff writable) so the member
 * signup and voucher redemption subdomains can be turned off from the
 * backoffice without a redeploy.
 */
import { useEffect, useState } from "react";
import { routedQuery } from "@/core/api/db-query";
import { commitOps } from "@/core/api/pos-db";
import { relayOp } from "@/core/api/sync-relay";
import { platformName } from "@/platform-config/platform";

export const MEMBER_FLAG = "member_domain_enabled";
export const REDEEM_FLAG = "redeem_domain_enabled";

export type PublicFlags = { member: boolean; redeem: boolean };

/** Optimistic default: everything open until the database says otherwise. */
let cache: PublicFlags = { member: true, redeem: true };
let loaded = false;
let inflight: Promise<PublicFlags> | null = null;
const listeners = new Set<(f: PublicFlags) => void>();

const emit = () => listeners.forEach((l) => l(cache));

export const publicFlags = () => cache;
export const memberDomainOn = () => cache.member;
export const redeemDomainOn = () => cache.redeem;

export async function loadPublicFlags(force = false): Promise<PublicFlags> {
  if (loaded && !force) return cache;
  if (inflight && !force) return inflight;
  inflight = (async () => {
    const data = await routedQuery("public_flags", { columns: "key,enabled", orderBy: { column: "key" }, limit: 100 });
    if (data) {
      const rows = data as unknown as { key: string; enabled: boolean }[];
      const pick = (key: string, fallback: boolean) =>
        rows.find((r) => r.key === key)?.enabled ?? fallback;
      cache = { member: pick(MEMBER_FLAG, true), redeem: pick(REDEEM_FLAG, true) };
      loaded = true;
      emit();
    }
    inflight = null;
    return cache;
  })();
  return inflight;
}

/** Staff-only write; the database rejects anyone else. */
export async function setPublicFlag(key: string, enabled: boolean) {
  if (platformName() === "electron") {
    // Public availability flags are central control-plane state. They must not
    // enter the local SQL business journal, whose pull-only guard correctly
    // rejects them. The authenticated relay applies the same POS-settings
    // permission check for password, PIN and terminal-backed sessions.
    const result = await relayOp({
      kind: "upsert",
      table: "public_flags",
      rows: [{ key, enabled }],
      onConflict: "key",
    });
    if (!result.ok) throw new Error(result.error ?? "The public page switch could not be saved.");
  } else {
    await commitOps("Saving public flag", [
      { kind: "upsert", table: "public_flags", rows: [{ key, enabled }] },
    ]);
  }
  cache = {
    member: key === MEMBER_FLAG ? enabled : cache.member,
    redeem: key === REDEEM_FLAG ? enabled : cache.redeem,
  };
  emit();
}

/** Live view of the switches; loads them once on first mount. */
export function usePublicFlags(): { flags: PublicFlags; ready: boolean } {
  const [flags, setFlags] = useState<PublicFlags>(cache);
  const [ready, setReady] = useState(loaded);
  useEffect(() => {
    listeners.add(setFlags);
    void loadPublicFlags().then((f) => {
      setFlags(f);
      setReady(true);
    });
    return () => {
      listeners.delete(setFlags);
    };
  }, []);
  return { flags, ready };
}
