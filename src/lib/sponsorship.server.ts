import { serviceRest } from "@/core/api/pos-relay.server";
import {
  sponsorshipApprovalPayload,
  sponsorshipSnapshot,
  type SponsorshipRecord,
} from "./sponsorship";
export async function sponsorshipRecord(id: string): Promise<SponsorshipRecord> {
  const response = await serviceRest(`sponsorship_issues?id=eq.${encodeURIComponent(id)}&limit=1`);
  if (!response.ok)
    throw new Error(
      /404/.test(String(response.status))
        ? "The sponsorship database upgrade is not installed yet"
        : "Could not read the sponsorship record",
    );
  const record = (await response.json())[0] as SponsorshipRecord | undefined;
  if (!record) throw new Error("Sponsorship was not found");
  return record;
}
export async function verifiedSponsorshipRequest(
  id: string | undefined,
  userId: string,
  storeId: string,
  payload: Record<string, unknown>,
) {
  if (!id) throw new Error("A sponsorship reference is required");
  const record = await sponsorshipRecord(id);
  if (
    record.created_by !== userId ||
    record.store_id !== storeId ||
    record.status === "issued" ||
    payload.sponsorship_id !== record.id ||
    payload.document_hash !== record.document_hash
  )
    throw new Error("The approval must match the saved sponsorship and its requester");
  return {
    record,
    payload: sponsorshipApprovalPayload(record),
    snapshot: sponsorshipSnapshot(record),
  };
}

export async function sponsorshipDirectAllowed(scope: {
  role: string | null;
  roleSlug: string | null;
  staffUserId?: string | null;
}) {
  if (scope.role === "admin" || scope.roleSlug === "admin") return true;
  const response = await serviceRest(
    "sponsorship_direct_issue_policy?id=eq.1&select=user_ids&limit=1",
  );
  if (!response.ok) throw new Error("Could not verify current sponsorship direct issue access");
  const rows = (await response.json()) as { user_ids: string[] }[];
  return !!scope.staffUserId && rows[0]?.user_ids.includes(scope.staffUserId) === true;
}
