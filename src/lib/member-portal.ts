import type { Session } from "@supabase/supabase-js";
import { memberPortalClientSnapshot } from "@/integrations/supabase/external-client";

export type MemberPortalProfile = {
  id: string;
  memberCode: string;
  fullName: string;
  phone: string;
  email: string;
  address: string;
  countryCode: string;
  postalCode: string;
  dateOfBirth: string | null;
  joinedAt: string;
  loyaltyPoints: number;
  totalSpent: number;
  verified: boolean;
  verifiedAt: string | null;
  verifiedChannel: string | null;
  tier: {
    id: string | null;
    name: string;
    discountPercentage: number;
    pointsMultiplier: number;
  };
};

export type MemberPortalSale = {
  id: string;
  billNumber: string;
  storeName: string;
  total: number;
  discount: number;
  pointsEarned: number;
  pointsRedeemed: number;
  refunded: boolean;
  createdAt: string;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    discount: number;
  }>;
};

type PortalRpcResult = { data: unknown; error: { message?: string } | null };
type PortalRpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<PortalRpcResult>;
};

const client = () => memberPortalClientSnapshot();
const rpcClient = () => client() as unknown as PortalRpcClient;

function message(error: { message?: string } | null, fallback: string): string {
  const raw = error?.message?.trim();
  if (!raw) return fallback;
  if (raw.includes("MEMBERSHIP_CONTACT_AMBIGUOUS")) {
    return "More than one membership uses this contact. Please ask the store to merge the duplicate records.";
  }
  if (raw.includes("MEMBERSHIP_ALREADY_CLAIMED")) {
    return "This membership is already linked to another login. Please contact the store for help.";
  }
  if (raw.includes("MEMBERSHIP_AUTH_REQUIRED")) return "Your login expired. Please sign in again.";
  return raw;
}

export async function memberPortalSession(): Promise<Session | null> {
  const { data, error } = await client().auth.getSession();
  if (error) throw new Error(error.message);
  return data.session;
}

export function onMemberPortalAuthChange(listener: (session: Session | null) => void) {
  const { data } = client().auth.onAuthStateChange((_event, session) => listener(session));
  return () => data.subscription.unsubscribe();
}

export async function sendMemberOtp(channel: "email" | "phone", destination: string) {
  const value = destination.trim();
  if (!value)
    throw new Error(
      channel === "email" ? "Enter your email address." : "Enter your mobile number.",
    );
  const input =
    channel === "email"
      ? { email: value, options: { shouldCreateUser: true } }
      : { phone: value, options: { shouldCreateUser: true } };
  const { error } = await client().auth.signInWithOtp(input);
  if (error) throw new Error(error.message);
}

export async function verifyMemberOtp(
  channel: "email" | "phone",
  destination: string,
  token: string,
): Promise<Session> {
  const value = destination.trim();
  const proof =
    channel === "email"
      ? { email: value, token, type: "email" as const }
      : { phone: value, token, type: "sms" as const };
  const { data, error } = await client().auth.verifyOtp(proof);
  if (error || !data.session) throw new Error(error?.message || "That code is invalid or expired.");
  return data.session;
}

export async function signOutMemberPortal(): Promise<void> {
  const { error } = await client().auth.signOut();
  if (error) throw new Error(error.message);
}

export async function loadMemberPortalProfile(): Promise<MemberPortalProfile | null> {
  const result = await rpcClient().rpc("membership_portal_profile");
  if (result.error) throw new Error(message(result.error, "Could not load your membership."));
  return result.data ? mapProfile(result.data as Record<string, unknown>) : null;
}

export async function enrollMemberPortal(input: {
  fullName: string;
  address?: string;
  dateOfBirth?: string;
  countryCode?: string;
  postalCode?: string;
}): Promise<MemberPortalProfile> {
  const result = await rpcClient().rpc("membership_portal_enroll_details", {
    p_profile: {
      full_name: input.fullName.trim(),
      address: input.address?.trim() || null,
      date_of_birth: input.dateOfBirth || null,
      country_code: input.countryCode?.trim().toUpperCase() || null,
      postal_code: input.postalCode?.trim() || null,
    },
  });
  if (result.error) throw new Error(message(result.error, "Could not create your membership."));
  return mapProfile(result.data as Record<string, unknown>);
}

export async function updateMemberPortal(input: {
  fullName: string;
  address?: string;
  dateOfBirth?: string;
  countryCode?: string;
  postalCode?: string;
}): Promise<MemberPortalProfile> {
  const result = await rpcClient().rpc("membership_portal_update_details", {
    p_profile: {
      full_name: input.fullName.trim(),
      address: input.address?.trim() || null,
      date_of_birth: input.dateOfBirth || null,
      country_code: input.countryCode?.trim().toUpperCase() || null,
      postal_code: input.postalCode?.trim() || null,
    },
  });
  if (result.error) throw new Error(message(result.error, "Could not update your membership."));
  return mapProfile(result.data as Record<string, unknown>);
}

export async function loadMemberPortalSales(limit = 25): Promise<MemberPortalSale[]> {
  const result = await rpcClient().rpc("membership_portal_sales", {
    p_limit: Math.min(Math.max(Math.trunc(limit), 1), 100),
  });
  if (result.error) throw new Error(message(result.error, "Could not load your purchase history."));
  const rows = Array.isArray(result.data) ? result.data : [];
  return rows.map((row) => {
    const value = row as Record<string, unknown>;
    const items = Array.isArray(value.items) ? value.items : [];
    return {
      id: String(value.id ?? ""),
      billNumber: String(value.bill_number ?? ""),
      storeName: String(value.store_name ?? ""),
      total: Number(value.total ?? 0),
      discount: Number(value.discount ?? 0),
      pointsEarned: Number(value.points_earned ?? 0),
      pointsRedeemed: Number(value.points_redeemed ?? 0),
      refunded: Boolean(value.refunded),
      createdAt: String(value.created_at ?? ""),
      items: items.map((item) => {
        const detail = item as Record<string, unknown>;
        return {
          name: String(detail.name ?? "Item"),
          quantity: Number(detail.quantity ?? 0),
          unitPrice: Number(detail.unit_price ?? 0),
          discount: Number(detail.discount ?? 0),
        };
      }),
    };
  });
}

function mapProfile(value: Record<string, unknown>): MemberPortalProfile {
  const tier = (value.tier ?? {}) as Record<string, unknown>;
  return {
    id: String(value.id ?? ""),
    memberCode: String(value.member_code ?? ""),
    fullName: String(value.full_name ?? ""),
    phone: String(value.phone ?? ""),
    email: String(value.email ?? ""),
    address: String(value.address ?? ""),
    countryCode: String(value.country_code ?? ""),
    postalCode: String(value.postal_code ?? ""),
    dateOfBirth: value.date_of_birth ? String(value.date_of_birth) : null,
    joinedAt: String(value.joined_at ?? ""),
    loyaltyPoints: Number(value.loyalty_points ?? 0),
    totalSpent: Number(value.total_spent ?? 0),
    verified: Boolean(value.verified),
    verifiedAt: value.verified_at ? String(value.verified_at) : null,
    verifiedChannel: value.verified_channel ? String(value.verified_channel) : null,
    tier: {
      id: tier.id ? String(tier.id) : null,
      name: String(tier.name ?? "Member"),
      discountPercentage: Number(tier.discount_percentage ?? 0),
      pointsMultiplier: Number(tier.points_multiplier ?? 1),
    },
  };
}
