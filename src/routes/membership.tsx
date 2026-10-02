import { createFileRoute, Link, redirect } from "@tanstack/react-router";
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
  Mail,
  MessageSquareText,
  Pencil,
  ReceiptText,
  ShieldCheck,
  Star,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { money } from "@/lib/pos-store";
import { isTerminalApp } from "@/platform-config/platform";
import { internationalPhone, PHONE_COUNTRIES } from "@/lib/phone-countries";
import {
  enrollMemberPortal,
  loadMemberPortalProfile,
  loadMemberPortalSales,
  memberPortalSession,
  onMemberPortalAuthChange,
  sendMemberOtp,
  signOutMemberPortal,
  updateMemberPortal,
  verifyMemberOtp,
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
  const refreshSequence = useRef(0);

  const refresh = useCallback(async (activeSession: Session | null) => {
    const sequence = ++refreshSequence.current;
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

  useEffect(() => {
    let active = true;
    void memberPortalSession()
      .then((current) => active && refresh(current))
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Could not restore your login.");
          setLoading(false);
        }
      });
    const unsubscribe = onMemberPortalAuthChange((current) => {
      if (active) void refresh(current);
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
                  .catch((cause) => toast.error(String(cause)))
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
        ) : !session ? (
          <MemberLogin onSignedIn={(next) => void refresh(next)} />
        ) : !profile ? (
          <MemberEnrollment
            session={session}
            error={error}
            onSaved={(next) => {
              setProfile(next);
              void loadMemberPortalSales()
                .then(setSales)
                .catch((cause) =>
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Your membership was saved, but purchase history could not be loaded.",
                  ),
                );
            }}
          />
        ) : (
          <MemberDashboard profile={profile} sales={sales} error={error} onProfile={setProfile} />
        )}
      </div>
    </main>
  );
}

function MemberLogin({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [channel, setChannel] = useState<"email" | "phone">("phone");
  const [destination, setDestination] = useState("");
  const [countryCode, setCountryCode] = useState("BN");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const send = async () => {
    setBusy(true);
    setError("");
    try {
      await sendMemberOtp(channel, memberOtpDestination(channel, countryCode, destination));
      setSent(true);
      toast.success(channel === "email" ? "Code sent to your email" : "Code sent by SMS");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send the code.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (code.length !== 6) return;
    setBusy(true);
    setError("");
    try {
      onSignedIn(
        await verifyMemberOtp(
          channel,
          memberOtpDestination(channel, countryCode, destination),
          code,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That code is invalid or expired.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <ShieldCheck className="mx-auto size-10 text-primary" aria-hidden />
      <h2 className="mt-3 text-center text-xl font-semibold">Secure member sign-in</h2>
      <p className="mt-1 text-center text-sm text-muted-foreground">
        We will send a one-time six-digit code. No password is stored.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
        <Button
          type="button"
          variant={channel === "phone" ? "secondary" : "ghost"}
          onClick={() => {
            setChannel("phone");
            setSent(false);
            setCode("");
            setError("");
          }}
        >
          <MessageSquareText className="size-4" /> SMS OTP
        </Button>
        <Button
          type="button"
          variant={channel === "email" ? "secondary" : "ghost"}
          onClick={() => {
            setChannel("email");
            setSent(false);
            setCode("");
            setError("");
          }}
        >
          <Mail className="size-4" /> Email OTP
        </Button>
      </div>

      <div className="mt-5 space-y-2">
        <Label htmlFor="member-destination">
          {channel === "email" ? "Email address" : "Mobile number"}
        </Label>
        <div className="flex gap-2">
          {channel === "phone" ? (
            <CountrySelect
              value={countryCode}
              disabled={busy || sent}
              onChange={setCountryCode}
              compact
            />
          ) : null}
          <Input
            id="member-destination"
            className="min-w-0 flex-1"
            type={channel === "email" ? "email" : "tel"}
            inputMode={channel === "email" ? "email" : "tel"}
            autoComplete={channel === "email" ? "email" : "tel-national"}
            placeholder={channel === "email" ? "you@example.com" : "8XX XXXX"}
            value={destination}
            disabled={busy}
            onChange={(event) => {
              setDestination(event.target.value);
              setSent(false);
              setCode("");
            }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {channel === "phone"
            ? "Choose the country code, then enter the mobile number."
            : "Use the email saved on your membership."}
        </p>
      </div>

      {sent ? (
        <div className="mt-5 space-y-3">
          <Label>Six-digit verification code</Label>
          <InputOTP
            maxLength={6}
            value={code}
            onChange={setCode}
            disabled={busy}
            containerClassName="justify-center"
          >
            <InputOTPGroup>
              {Array.from({ length: 6 }, (_, index) => (
                <InputOTPSlot key={index} index={index} className="h-11 w-11" />
              ))}
            </InputOTPGroup>
          </InputOTP>
          <Button
            className="w-full"
            disabled={busy || code.length !== 6}
            onClick={() => void verify()}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <BadgeCheck className="size-4" />}
            Verify and sign in
          </Button>
          <Button className="w-full" variant="ghost" disabled={busy} onClick={() => void send()}>
            Send a new code
          </Button>
        </div>
      ) : (
        <Button
          className="mt-5 w-full"
          disabled={busy || !destination.trim()}
          onClick={() => void send()}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Send verification code
        </Button>
      )}
      {error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function MemberEnrollment({
  session,
  error,
  onSaved,
}: {
  session: Session;
  error: string;
  onSaved: (profile: MemberPortalProfile) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [address, setAddress] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [countryCode, setCountryCode] = useState("BN");
  const [postalCode, setPostalCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const contact = session.user.phone || session.user.email || "verified contact";
  const verifiedPhone = session.user.phone?.trim() || "";

  return (
    <section className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <BadgeCheck className="size-9 text-primary" aria-hidden />
      <h2 className="mt-3 text-xl font-semibold">Complete your membership</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {contact} is verified. We could not find an existing membership for it, so complete your
        profile below.
      </p>
      {!verifiedPhone ? (
        <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          A verified mobile number is required because your phone number is your membership number.
          Sign out, choose SMS OTP, and verify your phone to continue.
        </p>
      ) : null}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="member-full-name">Full name</Label>
          <Input
            id="member-full-name"
            value={fullName}
            maxLength={120}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Country</Label>
          <CountrySelect value={countryCode} disabled={busy} onChange={setCountryCode} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="member-postal">Postal code (optional)</Label>
          <Input
            id="member-postal"
            value={postalCode}
            maxLength={32}
            autoComplete="postal-code"
            onChange={(e) => setPostalCode(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="member-dob">Date of birth</Label>
          <Input
            id="member-dob"
            type="date"
            value={dateOfBirth}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDateOfBirth(e.target.value)}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="member-address">Address (optional)</Label>
          <Input
            id="member-address"
            value={address}
            maxLength={500}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>
      </div>
      {formError || error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {formError || error}
        </p>
      ) : null}
      <Button
        className="mt-5 w-full"
        disabled={busy || !verifiedPhone || fullName.trim().length < 2}
        onClick={() => {
          setBusy(true);
          setFormError("");
          void enrollMemberPortal({ fullName, address, dateOfBirth, countryCode, postalCode })
            .then(onSaved)
            .catch((cause) =>
              setFormError(
                cause instanceof Error ? cause.message : "Could not save your membership.",
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Gift className="size-4" />}
        Become a Member
      </Button>
    </section>
  );
}

function MemberDashboard({
  profile,
  sales,
  error,
  onProfile,
}: {
  profile: MemberPortalProfile;
  sales: MemberPortalSale[];
  error: string;
  onProfile: (profile: MemberPortalProfile) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(profile.fullName);
  const [address, setAddress] = useState(profile.address);
  const [dateOfBirth, setDateOfBirth] = useState(profile.dateOfBirth ?? "");
  const [countryCode, setCountryCode] = useState(profile.countryCode || "BN");
  const [postalCode, setPostalCode] = useState(profile.postalCode);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const resetDraft = () => {
    setFullName(profile.fullName);
    setAddress(profile.address);
    setDateOfBirth(profile.dateOfBirth ?? "");
    setCountryCode(profile.countryCode || "BN");
    setPostalCode(profile.postalCode);
  };

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="bg-gradient-to-br from-primary to-primary/75 p-6 text-primary-foreground sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm opacity-90">
                <BadgeCheck className="size-4" /> Verified membership
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
                if (editing) resetDraft();
                setEditing((value) => !value);
              }}
            >
              <Pencil className="size-4" /> {editing ? "Cancel" : "Edit"}
            </Button>
          </div>
          {editing ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Full name">
                <Input
                  value={fullName}
                  maxLength={120}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </Field>
              <Field label="Date of birth">
                <Input
                  type="date"
                  value={dateOfBirth}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Address">
                  <Input
                    value={address}
                    maxLength={500}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Country">
                <CountrySelect value={countryCode} disabled={busy} onChange={setCountryCode} />
              </Field>
              <Field label="Postal code">
                <Input
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
        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        {sales.length === 0 ? (
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

function memberOtpDestination(channel: "email" | "phone", countryCode: string, value: string) {
  if (channel === "email") return value.trim();
  const country = PHONE_COUNTRIES.find((item) => item.code === countryCode) ?? PHONE_COUNTRIES[0];
  return internationalPhone(country, value);
}

function countryName(code: string) {
  return PHONE_COUNTRIES.find((country) => country.code === code)?.name || "Not provided";
}

function CountrySelect({
  value,
  disabled,
  onChange,
  compact = false,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <Select value={value} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger
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
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
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
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
