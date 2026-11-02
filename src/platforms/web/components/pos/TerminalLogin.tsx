import { ApprovalTokenButton } from "@/platform-config/approval-token";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Loader2, Lock, ReceiptText } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/pos-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBranding } from "@/lib/branding";
import { isTerminalApp } from "@/platform-config/platform";
import { CashierPinLogin } from "@/platforms/web/components/auth/CashierPinLogin";
import { isExternalEmail, usernameFromAddress } from "@/lib/internal-domains";
import { failureFromAuthError, isConfigurationFailure, loginFailureMessage, type LoginFailure } from "@/lib/login-failure";
import { hasNativePasswordManager, offerSaveLogin, requestSavedLogin } from "@/platform-config/password-manager";
import { createLoginView, type LoginView } from "@/lib/login-view";

export function TerminalLogin({ view: suppliedView }: { view?: LoginView } = {}) {
  const { login } = useAuth();
  const brand = useBranding();
  const [localView] = useState(createLoginView);
  const view = suppliedView ?? localView;
  const { mode, error, failure, busy } = useSyncExternalStore(view.subscribe, view.getSnapshot, view.getSnapshot);
  // Every browser, including localhost preview, is back-office access.
  // Registration and the PIN staff-list flow belong only to native shells.
  const [terminal, setTerminal] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    setTerminal(isTerminalApp());
    return () => { mounted.current = false; };
  }, []);
  const usernameField = useRef<HTMLInputElement>(null);
  const passwordField = useRef<HTMLInputElement>(null);
  // Platform detection may finish after the operator's choice. Only the
  // initial default depends on the platform; a browser always uses passwords.
  const tab = terminal ? mode ?? "cashier" : "admin";
  const [pinIdentifier, setPinIdentifier] = useState("");
  const [routed, setRouted] = useState(false);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-6">
      <div className="w-full max-w-sm space-y-5 rounded-lg border border-border bg-card p-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ReceiptText className="size-5" />
          </div>
          <div>
            <p className="font-semibold leading-tight">{brand.company}</p>
            <p className="text-xs text-muted-foreground">
              {terminal ? "Terminal sign in" : "Back office sign in"}
            </p>
          </div>
          <Lock className="ml-auto size-4 text-muted-foreground" />
        </div>

        <ApprovalTokenButton />
        <Tabs
          value={tab}
          onValueChange={(v) => {
            if (view.getSnapshot().busy) return;
            if (v === "admin" || (terminal && v === "cashier")) view.chooseMode(v);
          }}
        >
          {terminal && (
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="cashier" disabled={busy}>Sign in with PIN</TabsTrigger>
              <TabsTrigger value="admin" disabled={busy}>Supervisor / Admin</TabsTrigger>
            </TabsList>
          )}

          {terminal && (
            <TabsContent value="cashier">
              {routed && (
                <p className="rounded-md border border-border bg-surface-2 p-3 text-[11px] text-muted-foreground">
                  That is a till account, so it signs in with a PIN instead of a password.
                </p>
              )}
              <CashierPinLogin
                key={pinIdentifier}
                initialUsername={pinIdentifier}
                onAdminLogin={() => {
                  setRouted(false);
                  view.chooseMode("admin");
                }}
              />
            </TabsContent>
          )}

          <TabsContent value="admin" className="pt-4">
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (view.getSnapshot().busy) return;
                // Password managers can fill DOM fields without firing React's
                // change event. Read the submitted form so that autofill works
                // on both native WebViews as well as in the browser.
                const fields = new FormData(e.currentTarget);
                const submittedIdentifier = String(fields.get("username") ?? "").trim();
                const submittedPassword = String(fields.get("password") ?? "");
                const typed = submittedIdentifier.toLowerCase();
                // A cashier with no password goes to the PIN keypad. A staff
                // member who entered a password may use their login username.
                if (terminal && typed && !isExternalEmail(typed) && !submittedPassword) {
                  setPinIdentifier(usernameFromAddress(typed));
                  setRouted(true);
                  view.chooseMode("cashier");
                  return;
                }
                const request = view.beginRequest();
                if (!request) return;
                try {
                  const res = await login(submittedIdentifier, submittedPassword);
                  if (!res.ok) {
                    view.failRequest(request, res.error ?? "Sign in could not be completed.", (res as { code?: LoginFailure }).code ?? null);
                  } else if (hasNativePasswordManager) {
                    // The native OS password manager owns successfully verified credentials.
                    void offerSaveLogin(submittedIdentifier, submittedPassword).catch(() => {});
                  }
                } catch (cause) {
                  const code = failureFromAuthError(cause as Error);
                  view.failRequest(request, loginFailureMessage(code), code);
                } finally {
                  view.finishRequest(request);
                }

              }}
            >
              {hasNativePasswordManager && (
                <Button type="button" variant="outline" className="w-full" disabled={busy}
                  onClick={() => {
                    void requestSavedLogin().then((saved) => {
                      if (!mounted.current || !saved) return;
                      if (usernameField.current) usernameField.current.value = saved.username;
                      if (passwordField.current) passwordField.current.value = saved.password;
                      view.setError("");
                    }).catch(() => { if (mounted.current) view.setError("No saved login was selected. Enter your username and password to continue."); });
                  }}>
                  Use saved password
                </Button>
              )}
              <div className="space-y-1">
                <Label htmlFor="email">Email or username</Label>
                <Input
                  id="email"
                  ref={usernameField}
                  name="username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="Email or username"
                  onChange={() => view.setError("")}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  ref={passwordField}
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  onChange={() => view.setError("")}
                />
              </div>
              {error && (
                <div className="space-y-2">
                  <p className="text-sm text-destructive">{error}</p>
                  {failure && isConfigurationFailure(failure) && (isTerminalApp() ? (
                    <Button asChild variant="outline" className="w-full">
                      <Link to="/recovery" search={{ section: "connection" }}>Open connection settings</Link>
                    </Button>
                  ) : (
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
                  ))}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Sign in
              </Button>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {terminal
                  ? "Password accounts use their username or email; cashiers use the PIN tab."
                  : "Cashier PIN sign-in is only available on the desktop and mobile terminal apps."}
              </p>
            </form>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
