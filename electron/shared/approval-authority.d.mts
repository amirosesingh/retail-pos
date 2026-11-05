import type { AuthorizationRule, EffectiveAuthority, AuthPayload, TicketDiscount } from "../../src/lib/authorization";
type Person = { userId?: string | null; role?: string | null };
export function canAuthorize(rule: AuthorizationRule | undefined, who: Person): boolean;
export function approvalAuthority(rule: AuthorizationRule | undefined, who: Person): number | null;
export function effectiveApprovalAuthority(rule: AuthorizationRule | undefined, who: Person, directLimit?: number | null): EffectiveAuthority;
export function canAuthorizeAmount(rule: AuthorizationRule | undefined, who: Person, amount: number | null | undefined, directLimit?: number | null): boolean;
export function ticketDiscounts(payload: AuthPayload, field?: string): TicketDiscount[];
export function ticketDiscountApprovalPercent(entries: TicketDiscount[], requestedEntries?: TicketDiscount[]): number;
