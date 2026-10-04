import { createFileRoute, Link, Navigate, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  BadgeCheck,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Gift,
  Loader2,
  LogOut,
  Pencil,
  ReceiptText,
  ShieldAlert,
  Star,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { money } from "@/lib/pos-store";
import { isTerminalApp } from "@/platform-config/platform";
import { PHONE_COUNTRIES } from "@/lib/phone-countries";
import {
  loadMemberPortalProfile,
  loadMemberPortalSales,
  memberPortalSession,
  onMemberPortalAuthChange,
  signOutMemberPortal,
  updateMemberPortal,
  type MemberPortalProfile,
  type MemberPortalSale,
} from "@/lib/member-portal";

export const Route = createFileRoute("/membership")({
  beforeLoad: () => {
    if (isTerminalApp()) throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [
      { title: "My membership — Retail" },
      {
        name: "description",
        content: "Securely view your membership, loyalty points, tier and purchase history.",
      },
    ],
  }),
  component: MembershipPage,
});

function MembershipPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<MemberPortalProfile | null>(null);
  const [sales, setSales] = useState<MemberPortalSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sessionRestoreFailed, setSessionRestoreFailed] = useState(false);
  const refreshSequence = useRef(0);
  const currentUserId = useRef<string | null>(null);

  const refresh = useCallback(async (activeSession: Session | null) => {
    const sequence = ++refreshSequence.current;
    currentUserId.current = activeSession?.user.id ?? null;
    setSession(activeSession);
    if (!activeSession) {
      setProfile(null);
      setSales([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const nextProfile = await loadMemberPortalProfile();
      if (sequence !== refreshSequence.current) return;
      setProfile(nextProfile);
      const nextSales = nextProfile ? await loadMemberPortalSales() : [];
      if (sequence !== refreshSequence.current) return;
      setSales(nextSales);
    } catch (cause) {
      if (sequence !== refreshSequence.current) return;
      setError(cause instanceof Error ? cause.message : "Could not load your membership.");
    } finally {
      if (sequence === refreshSequence.current) setLoading(false);
    }
  }, []);

  const retrySessionRestore = useCallback(async () => {
    setLoading(true);
    setError("");
    setSessionRestoreFailed(false);
    try {
      await refresh(await memberPortalSession());
    } catch (cause) {
      setSessionRestoreFailed(true);
      setError(cause instanceof Error ? cause.message : "Could not restore your login.");
      setLoading(false);
    }
  }, [refresh]);

  useEffect(() => {
    let active = true;
    let authEventSeen = false;
    void memberPortalSession()
      .then((current) => {
        if (active && !authEventSeen) {
          setSessionRestoreFailed(false);
          return refresh(current);
        }
      })
      .catch((cause) => {
        if (active && !authEventSeen) {
          setSessionRestoreFailed(true);
          setError(cause instanceof Error ? cause.message : "Could not restore your login.");
          setLoading(false);
        }
      });
    const unsubscribe = onMemberPortalAuthChange((current) => {
      if (!active) return;
      authEventSeen = true;
      setSessionRestoreFailed(false);
      const nextUserId = current?.user.id ?? null;
      if (nextUserId === currentUserId.current) {
        setSession(current);
        return;
      }
      void refresh(current);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [refresh]);

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:py-12">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-7 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
              <Gift className="size-6" aria-hidden />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">My membership</h1>
              <p className="text-sm text-muted-foreground">Points, rewards and purchase history</p>
            </div>
          </div>
          {session ? (
            <Button
              variant="outline"
              onClick={() =>
                void signOutMemberPortal()
                  .then(() => toast.success("Signed out"))
                  .catch((cause) =>
                    toast.error(cause instanceof Error ? cause.message : "Could not sign out."),
                  )
              }
            >
              <LogOut className="size-4" /> Sign out
            </Button>
          ) : (
            <Link to="/join" className="text-sm font-medium text-primary hover:underline">
              Become a Member
            </Link>
          )}
        </header>

        {loading ? (
          <div className="flex min-h-64 items-center justify-center rounded-2xl border bg-card">
            <Loader2 className="size-7 animate-spin text-primary" aria-label="Loading" />
          </div>
        ) : !session && sessionRestoreFailed ? (
          <section className="mx-auto max-w-lg rounded-2xl border bg-card p-6 text-center shadow-sm">
            <h2 className="text-lg font-semibold">Could not restore your member session</h2>
            <p className="mt-2 text-sm text-destructive" role="alert">
              {error}
            </p>
            <Button className="mt-5" onClick={() => void retrySessionRestore()}>
              Retry member session
            </Button>
          </section>
        ) : !session ? (
          <Navigate to="/join" replace />
        ) : !profile && error ? (
          <section className="mx-auto max-w-lg rounded-2xl border bg-card p-6 text-center shadow-sm">
            <h2 className="text-lg font-semibold">Could not load your membership</h2>
            <p className="mt-2 text-sm text-destructive" role="alert">
              {error}
            </p>
            <Button className="mt-5" onClick={() => void refresh(session)}>
              Try again
            </Button>
          </section>
        ) : !profile ? (
          <Navigate to="/join" replace />
        ) : (
          <MemberDashboard
            profile={profile}
            sales={sales}
            error={error}
            onProfile={setProfile}
            onRetry={() => void refresh(session)}
          />
        )}
      </div>
    </main>
  );
}

function MemberDashboard({
  profile,
  sales,
  error,
  onProfile,
  onRetry,
}: {
  profile: MemberPortalProfile;
  sales: MemberPortalSale[];
  error: string;
  onProfile: (profile: MemberPortalProfile) => void;
  onRetry: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(profile.fullName);
  const [address, setAddress] = useState(profile.address);
  const [dateOfBirth, setDateOfBirth] = useState(profile.dateOfBirth ?? "");
  const [countryCode, setCountryCode] = useState(profile.countryCode);
  const [postalCode, setPostalCode] = useState(profile.postalCode);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const resetDraft = () => {
    setFullName(profile.fullName);
    setAddress(profile.address);
    setDateOfBirth(profile.dateOfBirth ?? "");
    setCountryCode(profile.countryCode);
    setPostalCode(profile.postalCode);
  };

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="bg-gradient-to-br from-primary to-primary/75 p-6 text-primary-foreground sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm opacity-90">
                {profile.verified ? (
                  <BadgeCheck className="size-4" />
                ) : (
                  <ShieldAlert className="size-4" />
                )}
                {profile.verified ? "Verified membership" : "Membership verification pending"}
              </div>
              <h2 className="mt-2 text-2xl font-semibold">{profile.fullName}</h2>
              <p className="mt-1 font-mono text-sm tracking-wide">{profile.memberCode}</p>
            </div>
            <Badge className="border-white/30 bg-white/15 text-white hover:bg-white/20">
              {profile.tier.name}
            </Badge>
          </div>
          <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <PortalStat
              icon={<Star />}
              label="Points"
              value={profile.loyaltyPoints.toLocaleString()}
            />
            <PortalStat
              icon={<ReceiptText />}
              label="Lifetime spend"
              value={money(profile.totalSpent)}
            />
            <PortalStat
              icon={<Gift />}
              label="Tier discount"
              value={`${profile.tier.discountPercentage}%`}
            />
            <PortalStat
              icon={<CalendarDays />}
              label="Member since"
              value={formatDate(profile.joinedAt)}
            />
          </div>
        </div>

        <div className="p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">Profile details</h3>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (!editing) resetDraft();
                setEditing((value) => !value);
              }}
            >
              <Pencil className="size-4" /> {editing ? "Cancel" : "Edit"}
            </Button>
          </div>
          {editing ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="member-profile-name">
                <Input
                  id="member-profile-name"
                  value={fullName}
                  maxLength={120}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </Field>
              <Field label="Date of birth" htmlFor="member-profile-dob">
                <Input
                  id="member-profile-dob"
                  type="date"
                  value={dateOfBirth}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Address" htmlFor="member-profile-address">
                  <Input
                    id="member-profile-address"
                    value={address}
                    maxLength={500}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Country" htmlFor="member-profile-country">
                <CountrySelect
                  id="member-profile-country"
                  value={countryCode}
                  disabled={busy}
                  onChange={setCountryCode}
                />
              </Field>
              <Field label="Postal code" htmlFor="member-profile-postal">
                <Input
                  id="member-profile-postal"
                  value={postalCode}
                  maxLength={32}
                  autoComplete="postal-code"
                  onChange={(e) => setPostalCode(e.target.value)}
                />
              </Field>
              <div className="sm:col-span-2">
                <Button
                  disabled={busy || fullName.trim().length < 2}
                  onClick={() => {
                    setBusy(true);
                    void updateMemberPortal({
                      fullName,
                      address,
                      dateOfBirth,
                      countryCode,
                      postalCode,
                    })
                      .then((next) => {
                        onProfile(next);
                        setEditing(false);
                        toast.success("Profile updated");
                      })
                      .catch((cause) =>
                        toast.error(
                          cause instanceof Error ? cause.message : "Could not update your profile.",
                        ),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}Save changes
                </Button>
              </div>
            </div>
          ) : (
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
              <Detail label="Mobile" value={profile.phone || "Not provided"} />
              <Detail label="Email" value={profile.email || "Not provided"} />
              <Detail
                label="Date of birth"
                value={profile.dateOfBirth ? formatDate(profile.dateOfBirth) : "Not provided"}
              />
              <Detail label="Address" value={profile.address || "Not provided"} />
              <Detail label="Country" value={countryName(profile.countryCode)} />
              <Detail label="Postal code" value={profile.postalCode || "Not provided"} />
            </dl>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <h3 className="font-semibold">Purchase history</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Your latest {Math.min(sales.length, 25)} member purchases
        </p>
        {error && sales.length === 0 ? (
          <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
            <Button className="mt-4" variant="outline" onClick={onRetry}>
              Retry purchase history
            </Button>
          </div>
        ) : sales.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            No member purchases yet.
          </div>
        ) : (
          <div className="mt-4 divide-y rounded-xl border">
            {sales.map((sale) => {
              const open = expanded === sale.id;
              return (
                <article key={sale.id}>
                  <button
                    className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-muted/50"
                    onClick={() => setExpanded(open ? null : sale.id)}
                  >
                    <div>
                      <p className="font-medium">Bill #{sale.billNumber}</p>
                      <p className="text-xs text-muted-foreground">
                        {sale.storeName} · {formatDateTime(sale.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="font-semibold tabular-nums">{money(sale.total)}</p>
                        <p className="text-xs text-muted-foreground">+{sale.pointsEarned} points</p>
                      </div>
                      {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                    </div>
                  </button>
                  {open ? (
                    <div className="border-t bg-muted/30 px-4 py-3">
                      {sale.items.map((item, index) => (
                        <div
                          key={`${sale.id}-${index}`}
                          className="flex justify-between gap-3 py-1 text-sm"
                        >
                          <span>
                            {item.quantity} × {item.name}
                          </span>
                          <span className="tabular-nums">
                            {money(item.unitPrice * item.quantity - item.discount)}
                          </span>
                        </div>
                      ))}
                      {sale.discount > 0 ? (
                        <div className="mt-2 flex justify-between border-t pt-2 text-sm text-primary">
                          <span>Total discount</span>
                          <span>-{money(sale.discount)}</span>
                        </div>
                      ) : null}
                      {sale.refunded ? (
                        <Badge variant="destructive" className="mt-2">
                          Refunded
                        </Badge>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function countryName(code: string) {
  return PHONE_COUNTRIES.find((country) => country.code === code)?.name || "Not provided";
}

function CountrySelect({
  id,
  value,
  disabled,
  onChange,
  compact = false,
}: {
  id?: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <Select value={value} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger
        id={id}
        className={compact ? "w-[118px] shrink-0" : "w-full"}
        aria-label={compact ? "Phone country code" : "Country"}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {PHONE_COUNTRIES.map((country) => (
          <SelectItem key={country.code} value={country.code}>
            {compact ? `${country.code} ${country.dial}` : `${country.name} (${country.dial})`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PortalStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-black/10 p-3 backdrop-blur-sm">
      <div className="flex items-center gap-1.5 text-xs opacity-85">
        {icon}
        {label}
      </div>
      <div className="mt-1 font-semibold tabular-nums">{value}</div>
    </div>
  );
}
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words font-medium">{value}</dd>
    </div>
  );
}
function formatDate(value: string) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        ...(dateOnly ? { timeZone: "UTC" } : {}),
      }).format(date);
}
function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
