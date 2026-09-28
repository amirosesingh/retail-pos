/**
 * Terminal sign-in for anyone who uses a PIN.
 *
 * Two steps: pick your name from the people who work at this branch, then
 * tap your PIN on the keypad. Sign-in fires as soon as the last digit lands.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Delete, Loader2, MapPin, ShieldAlert, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/pos-auth";

import { activeBranchId, boundBranchName } from "@/lib/active-branch";
import { isConfigurationFailure, type LoginFailure } from "@/lib/login-failure";
import { listTerminalStaff, type RosterReason, type TerminalStaff } from "@/lib/staff-admin";
import { usernameFromAddress } from "@/lib/internal-domains";
import {
  attemptsLeft,
  clearPinFailures,
  describeLockout,
  lockoutRemaining,
  notePinFailure,
} from "@/lib/pin-lockout";
import { cn } from "@/lib/utils";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** Plain wording for why the sign-in grid is empty. Never mentions a server. */
const ROSTER_WORDING: Record<RosterReason, string> = {
  ok: "",
  "no-server": "This till has not been connected to your company yet, so the staff list cannot load and a PIN cannot be checked.",
  unreachable:
    "Your company system did not answer, so the staff list could not load. You can still type your username below and sign in from this till's own records.",
  "not-authorised":
    "This till is not registered yet, so it is not allowed to load the staff list. Complete terminal setup first.",
  empty: "Nobody is assigned to this branch yet. Type your username below.",
};


export function CashierPinLogin({
  onAdminLogin,
  initialUsername = "",
}: {
  onAdminLogin?: () => void;
  initialUsername?: string;
}) {
  const { cashierLogin } = useAuth();
  const [staff, setStaff] = useState<TerminalStaff[]>([]);
  const [reason, setReason] = useState<RosterReason>("ok");
  // Set when the till itself is not connected — that is a setup problem, not
  // a wrong PIN, and it gets a way out of the screen instead of a lockout.
  const [configFailure, setConfigFailure] = useState<LoginFailure | null>(null);
  // Which branch this till belongs to. An unbound till says so plainly rather
  // than showing an empty list with no explanation.
  const [branchLabel] = useState(
    () => boundBranchName() ?? (activeBranchId(null) ? "This branch" : "No branch set"),
  );
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<TerminalStaff | null>(null);
  // What is being typed, and what has actually been committed. Keeping them
  // apart is what lets someone type a whole username without the screen
  // jumping to the keypad after the first character.
  const [draft, setDraft] = useState(initialUsername);
  const [manual, setManual] = useState(initialUsername.trim().toLowerCase());
  const [typing, setTyping] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lockedFor, setLockedFor] = useState(() => lockoutRemaining());
  const pinRef = useRef(pin);
  const submittingRef = useRef(false);
  pinRef.current = pin;

  // Countdown while the keypad is locked after too many wrong PINs.
  useEffect(() => {
    if (!lockedFor) return;
    const t = window.setInterval(() => setLockedFor(lockoutRemaining()), 1000);
    return () => window.clearInterval(t);
  }, [lockedFor]);

  useEffect(() => {
    let live = true;
    const branch = activeBranchId(null);
    void (async () => {
      const rosterResult: { rows: TerminalStaff[]; why: RosterReason } = await (async () => {
        try {
        const roster = await listTerminalStaff(branch);
          return { rows: roster.staff, why: roster.reason };
        } catch {
          return { rows: [], why: "unreachable" };
        }
      })();
      let { rows, why } = rosterResult;
      // No answer from the server: offer the roster mirrored into this till's
      // own database, so a cut-off branch still sees who can sign in.
      if (!rows.length) {
        try {
          const { localStaffRoster } = await import("@/core/local-db/local-staff");
          rows = (await localStaffRoster(branch)).map((r) => ({
            username: r.username,
            fullName: r.fullName,
            pinLength: r.pinLength,
            roleSlug: r.roleSlug,
            storeId: r.storeId,
          })) as unknown as TerminalStaff[];
          if (rows.length) why = "ok";
        } catch {
          rows = [];
        }
      }
      if (!live) return;
      setStaff(Array.isArray(rows) ? rows : []);
      setReason(why);
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, []);


  // A whole internal address is accepted too — it is what the account list
  // shows — so it is reduced to the username before anything is sent.
  const username = picked?.username ?? usernameFromAddress(manual);
  const storedLength = picked?.pinLength ?? 0;
  // A numeric PIN is 4-6 digits. Anything longer is a typed passcode, which
  // gets a plain field with no length cap and no auto-submit.
  const passcodeAccount = storedLength > 12;
  // Known account: submit as soon as the expected digit lands. Unknown
  // (typed) username: allow up to 12 digits and wait for an explicit Sign in.
  const knownLength = storedLength >= 4 && storedLength <= 12 ? storedLength : 0;
  const pinLength = knownLength || 12;
  const keypadMode = !typing && !passcodeAccount;

  // Someone whose credential is a long passcode never sees the keypad.
  useEffect(() => {
    if (passcodeAccount) setTyping(true);
  }, [passcodeAccount]);

  const submit = useCallback(
    async (value: string) => {
      // State updates do not become visible until React renders again. A fast
      // final keypad tap plus Enter could therefore enter this callback more
      // than once while `busy` was still false and send duplicate PIN checks.
      if (submittingRef.current) return;
      if (!username) {
        setError("Choose who is signing in");
        return;
      }
      const waiting = lockoutRemaining();
      if (waiting) {
        setLockedFor(waiting);
        setPin("");
        return;
      }
      submittingRef.current = true;
      setBusy(true);
      setError("");
      try {
        const res = await cashierLogin(username, value);
        if (!res.ok) {
          const message = res.error ?? "That PIN was not recognised";
          const deactivated = /deactivat|not active|blocked/i.test(message);
          setPin("");
          if (res.code === "session-open-failed") {
            clearPinFailures();
            setError(message);
          // A till that is not connected has not judged the PIN at all, so the
          // attempt must not count towards the keypad lockout.
          } else if (res.code && isConfigurationFailure(res.code)) {
            setConfigFailure(res.code);
            setError(message);
          } else if (deactivated) {
            setError("Account deactivated. Please contact an administrator.");
          } else {
            const locked = notePinFailure();
            setLockedFor(locked);
            const left = attemptsLeft();
            setError(
              locked
                ? ""
                : `${message}${left ? ` — ${left} attempt${left === 1 ? "" : "s"} left` : ""}`,
            );
          }
        } else {
          clearPinFailures();
        }
      } finally {
        submittingRef.current = false;
        setBusy(false);
      }
    },
    [cashierLogin, username],
  );

  const press = (digit: string) => {
    if (busy || lockedFor || pinRef.current.length >= pinLength) return;
    const next = pinRef.current + digit;
    setPin(next);
    setError("");
    if (knownLength && next.length === knownLength) void submit(next);
  };

  // Physical keyboards and keypads work exactly like the on-screen pad.
  useEffect(() => {
    if ((!picked && !manual) || !keypadMode) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && el.tagName === "INPUT" && el.id === "pin-username") return;
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        press(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        setPin(pinRef.current.slice(0, -1));
      } else if (e.key === "Enter" && pinRef.current.length >= 4) {
        e.preventDefault();
        void submit(pinRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, manual, busy, pinLength, keypadMode, submit]);

  /* ---------------------------- step one: person --------------------------- */
  if (!picked && !manual) {
    const commitDraft = () => {
      const value = draft.trim().toLowerCase();
      if (!value) {
        setError("Enter your username to continue");
        return;
      }
      setManual(value);
      setPin("");
      setError("");
    };
    return (
      <div className="space-y-4 pt-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium">Who is signing in?</p>
            <p className="text-[11px] text-muted-foreground">
              Tap your name to continue to the keypad.
            </p>
          </div>
          <Badge variant="outline" className="ml-auto shrink-0 gap-1 text-[10px]">
            <MapPin className="size-3" />
            {branchLabel}
          </Badge>
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : staff?.length ? (
          <div className="grid max-h-[46vh] grid-cols-2 gap-2 overflow-y-auto">
            {staff.map((s) => (
              <button
                key={s.username}
                type="button"
                onClick={() => {
                  setPicked(s);
                  setPin("");
                  setError("");
                }}
                className="flex flex-col items-start gap-1 rounded-md border border-border bg-surface-2 p-3 text-left transition-colors hover:bg-accent"
              >
                <UserRound className="size-4 text-muted-foreground" />
                <span className="w-full truncate text-sm font-medium">
                  {s.fullName || s.username}
                </span>
                <Badge variant="outline" className="text-[10px] capitalize">
                  {s.roleSlug.replace(/-/g, " ")}
                </Badge>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-2 rounded-md border border-border bg-surface-2 p-3">
            <p className="text-xs text-muted-foreground">{ROSTER_WORDING[reason]}</p>
            {(reason === "no-server" || reason === "not-authorised") && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  window.location.href =
                    reason === "no-server" ? "/settings/database" : "/settings/terminals";
                }}
              >
                {reason === "no-server" ? "Open connection settings" : "Open terminal setup"}
              </Button>
            )}
          </div>
        )}

        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            commitDraft();
          }}
        >
          <Label htmlFor="pin-username">Or enter a username</Label>
          <Input
            id="pin-username"
            autoComplete="username"
            placeholder="cashier101"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value.replace(/\s+/g, ""));
              setError("");
            }}
            onBlur={() => {
              if (draft.trim().length >= 2) commitDraft();
            }}
            className="h-11 text-center"
          />
          <Button type="submit" variant="outline" className="w-full" disabled={!draft.trim()}>
            Next
          </Button>
          {error && <p className="text-center text-sm text-destructive">{error}</p>}
        </form>
        {onAdminLogin && (
          <Button type="button" variant="ghost" className="w-full text-xs" onClick={onAdminLogin}>
            Administrator sign in with email and password
          </Button>
        )}
      </div>
    );
  }

  /* ------------------------------ step two: PIN ---------------------------- */
  return (
    <div className="space-y-5 pt-4">
      <div className="flex items-center gap-3 rounded-md border border-border bg-surface-2 p-3">
        <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
          <UserRound className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{picked?.fullName || username}</p>
          <p className="truncate text-[11px] text-muted-foreground">{username}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto"
          disabled={busy}
          onClick={() => {
            setPicked(null);
            setManual("");
            setDraft("");
            setTyping(false);
            setPin("");
            setError("");
          }}
        >
          <ArrowLeft className="size-4" /> Change
        </Button>
      </div>

      <div
        className="flex items-center justify-center gap-3 rounded-md border border-border bg-surface-2 py-3"
        aria-label="PIN entry"
        role="status"
      >
        {Array.from({ length: Math.min(pinLength, 12) }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "size-3.5 rounded-full border border-border",
              i < pin.length ? "bg-primary" : "bg-transparent",
            )}
          />
        ))}
      </div>

      {lockedFor > 0 && (
        <p className="flex items-center justify-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-center text-xs text-destructive">
          <ShieldAlert className="size-4 shrink-0" />
          Too many wrong PINs. Try again in {describeLockout(lockedFor)}.
        </p>
      )}

      {keypadMode ? (
      <form
        className="grid grid-cols-3 gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (pin.length >= 4) void submit(pin);
        }}
      >
        {KEYS.map((k) => (
          <Button
            key={k}
            type="button"
            variant="outline"
            className="h-14 text-lg"
            disabled={busy || lockedFor > 0}
            onClick={() => press(k)}
          >
            {k}
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          className="h-14 text-xs"
          disabled={busy || lockedFor > 0}
          onClick={() => {
            setPin("");
            setError("");
          }}
        >
          Clear
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-14 text-lg"
          disabled={busy || lockedFor > 0}
          onClick={() => press("0")}
        >
          0
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-14"
          aria-label="Delete last digit"
          disabled={busy || lockedFor > 0}
          onClick={() => setPin(pin.slice(0, -1))}
        >
          <Delete className="size-5" />
        </Button>
        {!knownLength && (
          <Button
            type="submit"
            className="col-span-3 h-12"
            disabled={busy || lockedFor > 0 || pin.length < 4}
          >
            Sign in
          </Button>
        )}
      </form>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (pin.length >= 4) void submit(pin);
          }}
        >
          <Label htmlFor="pin-passcode">{passcodeAccount ? "Passcode" : "PIN"}</Label>
          <Input
            id="pin-passcode"
            type="password"
            autoFocus
            autoComplete="current-password"
            {...(passcodeAccount
              ? { maxLength: 64 }
              : { inputMode: "numeric" as const, pattern: "[0-9]*", maxLength: 6 })}
            value={pin}
            disabled={busy || lockedFor > 0}
            onChange={(e) => {
              const raw = e.target.value;
              setPin(passcodeAccount ? raw : raw.replace(/\D+/g, "").slice(0, 6));
              setError("");
            }}
            className="h-12 text-center"
          />
          <Button type="submit" className="w-full" disabled={busy || lockedFor > 0 || pin.length < 4}>
            Sign in
          </Button>
        </form>
      )}

      {!passcodeAccount && (
        <Button
          type="button"
          variant="ghost"
          className="w-full text-xs"
          disabled={busy}
          onClick={() => {
            setTyping(!typing);
            setPin("");
            setError("");
          }}
        >
          {typing ? "Use the keypad" : "Type my passcode instead"}
        </Button>
      )}

      {busy && (
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Signing in…
        </p>
      )}
      {error && <p className="text-center text-sm text-destructive">{error}</p>}
      {configFailure && isConfigurationFailure(configFailure) && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => {
            window.location.href = "/settings/database";
          }}
        >
          Open connection settings
        </Button>
      )}
      {onAdminLogin && (
        <Button type="button" variant="ghost" className="w-full text-xs" onClick={onAdminLogin}>
          Administrator sign in with email and password
        </Button>
      )}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        PINs are checked by the backend. Once you have signed in here, the same PIN works with
        no connection.
      </p>
    </div>
  );
}
