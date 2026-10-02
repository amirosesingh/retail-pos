import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { BadgeCheck, Gift, Loader2, Mail, MessageSquareText, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  enrollMemberPortal,
  sendMemberOtp,
  verifyMemberOtp,
  type MemberPortalProfile,
} from "@/lib/member-portal";
import { usePublicFlags } from "@/lib/public-flags";
import { internationalPhone, PHONE_COUNTRIES } from "@/lib/phone-countries";
import { PublicPageClosed } from "@/platforms/web/components/pos/PublicPageClosed";

export const Route = createFileRoute("/join")({
  head: () => ({
    meta: [
      { title: "Join the rewards club — Retail" },
      { name: "description", content: "Create a verified membership with an email or SMS OTP." },
    ],
  }),
  component: JoinPage,
});

function JoinPage() {
  const { flags, ready } = usePublicFlags();
  const [channel, setChannel] = useState<"email" | "phone">("phone");
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [address, setAddress] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [countryCode, setCountryCode] = useState("BN");
  const [postalCode, setPostalCode] = useState("");
  const [code, setCode] = useState("");
  const [otpVerified, setOtpVerified] = useState(false);
  const [step, setStep] = useState<"details" | "verify" | "done">("details");
  const [member, setMember] = useState<MemberPortalProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const validationError = () => {
    if (name.trim().length < 2) return "Enter your full name.";
    if (channel === "email" && !/^\S+@\S+\.\S+$/.test(destination.trim())) {
      return "Enter a valid email address.";
    }
    if (channel === "phone" && destination.replace(/\D/g, "").length < 6) {
      return "Enter a valid mobile number.";
    }
    if (dateOfBirth && new Date(dateOfBirth) > new Date()) return "Enter a valid date of birth.";
    return "";
  };

  const send = async () => {
    const invalid = validationError();
    if (invalid) return setError(invalid);
    setBusy(true);
    setError("");
    try {
      setOtpVerified(false);
      await sendMemberOtp(channel, otpDestination(channel, countryCode, destination));
      setCode("");
      setStep("verify");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send the verification code.");
    } finally {
      setBusy(false);
    }
  };

  const verifyAndCreate = async () => {
    if (code.length !== 6) return;
    setBusy(true);
    setError("");
    try {
      if (!otpVerified) {
        await verifyMemberOtp(channel, otpDestination(channel, countryCode, destination), code);
        setOtpVerified(true);
      }
      const profile = await enrollMemberPortal({
        fullName: name,
        address,
        dateOfBirth,
        countryCode,
        postalCode,
      });
      setMember(profile);
      setStep("done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create your membership.");
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <main className="min-h-screen bg-background" />;
  if (!flags.member) return <PublicPageClosed what="Member signup" />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <section className="w-full max-w-xl rounded-2xl border bg-card p-6 shadow-lg sm:p-8">
        {step === "done" ? (
          <div className="text-center">
            <PartyPopper className="mx-auto size-11 text-primary" aria-hidden />
            <h1 className="mt-4 text-2xl font-semibold">
              You're in, {member?.fullName.split(" ")[0]}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Your contact is verified and membership {member?.memberCode} is active.
            </p>
            <Button asChild className="mt-6">
              <Link to="/membership">View my membership</Link>
            </Button>
          </div>
        ) : (
          <>
            <header className="text-center">
              <Gift className="mx-auto size-10 text-primary" aria-hidden />
              <h1 className="mt-4 text-2xl font-semibold">Join the rewards club</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Required: full name and one verified email or mobile number. Address and date of
                birth, country and postal details complete your account profile.
              </p>
            </header>

            <div className="mt-6 grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
              <ChannelButton
                active={channel === "phone"}
                disabled={busy || step === "verify"}
                onClick={() => switchChannel("phone", setChannel, setDestination, setError)}
                icon={<MessageSquareText className="size-4" />}
              >
                SMS OTP
              </ChannelButton>
              <ChannelButton
                active={channel === "email"}
                disabled={busy || step === "verify"}
                onClick={() => switchChannel("email", setChannel, setDestination, setError)}
                icon={<Mail className="size-4" />}
              >
                Email OTP
              </ChannelButton>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Full name *" htmlFor="join-name" wide>
                <Input
                  id="join-name"
                  value={name}
                  maxLength={120}
                  disabled={busy || step === "verify"}
                  autoComplete="name"
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label={channel === "email" ? "Email address *" : "Mobile number *"} htmlFor="join-contact">
                <div className="flex gap-2">
                  {channel === "phone" ? (
                    <CountrySelect value={countryCode} disabled={busy || step === "verify"} onChange={setCountryCode} compact />
                  ) : null}
                  <Input
                    id="join-contact"
                    className="min-w-0 flex-1"
                    type={channel === "email" ? "email" : "tel"}
                    inputMode={channel === "email" ? "email" : "tel"}
                    value={destination}
                    maxLength={160}
                    disabled={busy || step === "verify"}
                    autoComplete={channel === "email" ? "email" : "tel-national"}
                    placeholder={channel === "email" ? "you@example.com" : "8XX XXXX"}
                    onChange={(e) => setDestination(e.target.value)}
                  />
                </div>
              </Field>
              <Field label="Date of birth (optional)" htmlFor="join-dob">
                <Input
                  id="join-dob"
                  type="date"
                  value={dateOfBirth}
                  disabled={busy || step === "verify"}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                />
              </Field>
              <Field label="Address (optional)" htmlFor="join-address" wide>
                <Input
                  id="join-address"
                  value={address}
                  maxLength={500}
                  disabled={busy || step === "verify"}
                  autoComplete="street-address"
                  onChange={(e) => setAddress(e.target.value)}
                />
              </Field>
              <Field label="Country" htmlFor="join-country">
                <CountrySelect value={countryCode} disabled={busy || step === "verify"} onChange={setCountryCode} />
              </Field>
              <Field label="Postal code (optional)" htmlFor="join-postal">
                <Input
                  id="join-postal"
                  value={postalCode}
                  maxLength={32}
                  disabled={busy || step === "verify"}
                  autoComplete="postal-code"
                  onChange={(e) => setPostalCode(e.target.value)}
                />
              </Field>
            </div>

            {step === "verify" ? (
              <div className="mt-5 space-y-3 rounded-xl border bg-muted/30 p-4">
                <div>
                  <Label>Six-digit verification code</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Sent to {otpDestination(channel, countryCode, destination)}. Nothing is saved until the code is verified.
                  </p>
                </div>
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
                  onClick={() => void verifyAndCreate()}
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <BadgeCheck className="size-4" />
                  )}
                  Verify and create membership
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setOtpVerified(false);
                      setCode("");
                      setStep("details");
                    }}
                  >
                    Change details
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => void send()}>
                    Resend code
                  </Button>
                </div>
              </div>
            ) : (
              <Button className="mt-5 w-full" disabled={busy} onClick={() => void send()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}Send verification code
              </Button>
            )}
            {error ? (
              <p className="mt-3 text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <p className="mt-4 text-center text-xs text-muted-foreground">
              We use your verified contact for secure membership access and loyalty communication.
            </p>
            <p className="mt-2 text-center text-sm text-muted-foreground">
              Already a member?{" "}
              <Link to="/membership" className="font-medium text-primary hover:underline">
                Sign in with OTP
              </Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}

function otpDestination(channel: "email" | "phone", countryCode: string, value: string) {
  if (channel === "email") return value.trim();
  const country = PHONE_COUNTRIES.find((item) => item.code === countryCode) ?? PHONE_COUNTRIES[0];
  return internationalPhone(country, value);
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
      <SelectTrigger id={compact ? undefined : "join-country"} className={compact ? "w-[118px] shrink-0" : "w-full"} aria-label={compact ? "Phone country code" : "Country"}>
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

function switchChannel(
  channel: "email" | "phone",
  setChannel: (value: "email" | "phone") => void,
  setDestination: (value: string) => void,
  setError: (value: string) => void,
) {
  setChannel(channel);
  setDestination("");
  setError("");
}

function ChannelButton({
  active,
  disabled,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {children}
    </Button>
  );
}

function Field({
  label,
  htmlFor,
  wide = false,
  children,
}: {
  label: string;
  htmlFor: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${wide ? "sm:col-span-2" : ""}`}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
