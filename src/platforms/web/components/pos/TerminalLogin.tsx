import { useEffect, useState } from "react";
import { Loader2, Lock, ReceiptText } from "lucide-react";
import { useAuth } from "@/lib/pos-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBranding } from "@/lib/branding";
import { isLocalWebCashierTest, isTerminalApp } from "@/platform-config/platform";
import { CashierPinLogin } from "@/platforms/web/components/auth/CashierPinLogin";
import { isExternalEmail, usernameFromAddress } from "@/lib/internal-domains";
import { isConfigurationFailure, type LoginFailure } from "@/lib/login-failure";

export function TerminalLogin() {
  const { login } = useAuth();
  const brand = useBranding();
  // Production browsers remain back-office only. Local Vite development also
  // exposes the terminal tab so the complete cashier approval flow can be
  // exercised against the configured backend before a device build is made.
  const [terminal, setTerminal] = useState(false);
  useEffect(() => setTerminal(isTerminalApp() || isLocalWebCashierTest()), []);
  const [error, setError] = useState("");
  // Why the last attempt failed. A connection problem gets a way out of the
  // screen; only a genuine refusal is presented as a wrong password.
  const [failure, setFailure] = useState<LoginFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tab, setTab] = useState("admin");
  const [pinIdentifier, setPinIdentifier] = useState("");
  const [routed, setRouted] = useState(false);


  useEffect(() => {
    setTab(terminal ? "cashier" : "admin");
  }, [terminal]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
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

        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v);
            setError("");
          }}
        >
          {terminal && (
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="cashier">Cashier PIN</TabsTrigger>
              <TabsTrigger value="admin">Supervisor / Admin</TabsTrigger>
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
                  setTab("admin");
                }}
              />
            </TabsContent>
          )}

          <TabsContent value="admin" className="pt-4">
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                const typed = email.trim().toLowerCase();
                // Internal accounts (bare usernames and our own hidden
                // domains) never use a password — hand them to the keypad.
                if (terminal && typed && !isExternalEmail(typed)) {
                  setPinIdentifier(usernameFromAddress(typed));
                  setRouted(true);
                  setError("");
                  setTab("cashier");
                  return;
                }
                setBusy(true);
                setError("");
                setFailure(null);
                const res = await login(email, password);
                if (!res.ok) {
                  setError(res.error ?? "Sign in could not be completed.");
                  setFailure((res as { code?: LoginFailure }).code ?? null);
                }
                setBusy(false);

              }}
            >
              <div className="space-y-1">
                <Label htmlFor="email">Email or username</Label>
                <Input
                  id="email"
                  type="text"
                  autoComplete="email"
                  placeholder="supervisor@store.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError("");
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError("");
                  }}
                />
              </div>
              {error && (
                <div className="space-y-2">
                  <p className="text-sm text-destructive">{error}</p>
                  {failure && isConfigurationFailure(failure) && (
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
                </div>
              )}

              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Sign in
              </Button>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {terminal
                  ? "Supervisor and admin accounts sign in with email and password; cashiers use the PIN tab."
                  : "Cashier PIN sign-in is only available on the desktop and mobile terminal apps."}
              </p>
            </form>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
