import { useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useAuth } from "@/lib/pos-auth";
import { disableLocalPhonePush, phoneEnrollmentGeneration, enableLocalPhonePush } from "@/lib/android-push-device";
import { isAndroid } from "@/platform-config/platform";
import { getDeviceSecret, setDeviceSecret } from "@/lib/device-secrets";
import { PHONE_PUSH_BINDING, type PhonePushBinding } from "@/lib/android-push-device";
import { supabaseConfig, hasSupabaseConfig } from "@/lib/external-supabase-config";
import { updateAndroidPushDevice } from "@/lib/android-push.functions";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
type Pending = { eventId: string; userId: string; email: string };
export function AndroidPushAgent() {
  const auth = useAuth();
  const current = useRef(auth);
  current.current = auth;
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const configured = isAndroid() && import.meta.env.VITE_ANDROID_PUSH_ENABLED === "true";
  const cloud = configured && hasSupabaseConfig() ? supabaseConfig().url : "";
  useEffect(() => {
    if (!configured) return;
    let stopped = false;
    const handles: { remove(): Promise<void> }[] = [];
    const open = async (data: Record<string, string>) => {
      const binding = await getDeviceSecret<PhonePushBinding>(PHONE_PUSH_BINDING);
      if (
        !binding ||
        binding.cloud !== supabaseConfig().url ||
        binding.userId !== data.userId ||
        binding.tenant !== data.tenantId ||
        !/^[0-9a-f-]{36}$/i.test(data.eventId ?? "")
      )
        return;
      if (current.current.user) await current.current.lock();
      if (stopped) return;
      setPassword("");
      setError("");
      setPending({ eventId: data.eventId, userId: binding.userId, email: binding.email });
    };
    void (async () => {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      handles.push(
        await PushNotifications.addListener("pushNotificationActionPerformed", (event) => {
          void open(event.notification.data ?? {});
        }),
      );
      handles.push(
        await LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
          void open(event.notification.extra ?? {});
        }),
      );
      if (stopped) await Promise.all(handles.map((handle) => handle.remove()));
    })().catch(() => {
      if (!stopped) toast.error("Phone notifications could not start.");
    });
    return () => {
      stopped = true;
      void Promise.all(handles.map((handle) => handle.remove()));
    };
  }, [configured]);
  useEffect(() => {
    if (!configured || !auth.appUser?.user_id || !auth.appUser.email) return;
    let stopped = false;
    let listener: { remove(): Promise<void> } | undefined;
    const owner = { user_id: auth.appUser.user_id, email: auth.appUser.email };
    void (async () => {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      const old = await getDeviceSecret<PhonePushBinding>(PHONE_PUSH_BINDING);
      if (old && (old.userId !== owner.user_id || old.cloud !== cloud)) {
        await disableLocalPhonePush();
        await PushNotifications.unregister();
        await PushNotifications.removeAllDeliveredNotifications();
        await LocalNotifications.removeAllDeliveredNotifications();
      }
      let permission = await PushNotifications.checkPermissions();
      if (permission.receive === "prompt")
        permission = await PushNotifications.requestPermissions();
      if (stopped || permission.receive !== "granted") return;
      await LocalNotifications.requestPermissions();
      await PushNotifications.createChannel({
        id: "pos_alerts",
        name: "POS alerts",
        importance: 4,
        visibility: 0,
      });
      await LocalNotifications.createChannel({
        id: "pos_alerts",
        name: "POS alerts",
        importance: 4,
        visibility: 0,
      });
      const enrollment = phoneEnrollmentGeneration();
      listener = await PushNotifications.addListener("registration", async (registration) => {
        if (stopped) return;
        try {
          const deviceId = old?.deviceId ?? crypto.randomUUID();
          const proof = await getPosCallerAuth();
          const result = await updateAndroidPushDevice({
            data: { ...proof, action: "register", deviceId, token: registration.value },
          });
          if (!stopped && enrollment === phoneEnrollmentGeneration()) {
            await setDeviceSecret(PHONE_PUSH_BINDING, {
              deviceId,
              token: registration.value,
              userId: owner.user_id,
              email: owner.email,
              tenant: result.tenant,
              cloud,
            });
            if (!stopped) await enableLocalPhonePush({userId:owner.user_id,tenantId:result.tenant},enrollment);
          }
        } catch {
          if (!stopped)
            toast.error("Phone alert registration failed. Reopen the app when connected to retry.");
        }
      });
      if (stopped) {
        await listener.remove();
        return;
      }
      await PushNotifications.register();
    })().catch(() => {
      if (!stopped)
        toast.error("Phone notifications are unavailable. Check Android notification settings.");
    });
    return () => {
      stopped = true;
      void listener?.remove();
    };
  }, [configured, auth.appUser?.user_id, auth.appUser?.email, cloud]);
  if (!configured) return null;
  return (
    <Dialog
      open={!!pending}
      onOpenChange={(open) => {
        if (!open && !busy) {
          setPending(null);
          setPassword("");
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open phone alert</DialogTitle>
          <DialogDescription>
            Enter your password to open the notification feed. Your current permissions control
            which details you can see.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!pending || busy) return;
            setBusy(true);
            setError("");
            try {
              const result = await current.current.login(pending.email, password);
              if (!result.ok) {
                setError(result.error ?? "Could not sign in.");
                return;
              }
              setPending(null);
              setPassword("");
              await router.navigate({ to: "/reports/notifications" });
            } catch {
              setError("Could not open the alert. Check your connection.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Label htmlFor="push-owner">Account</Label>
          <Input id="push-owner" value={pending?.email ?? ""} readOnly autoComplete="username" />
          <Label htmlFor="push-password">Password</Label>
          <Input
            id="push-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy || !password}>
            {busy ? "Signing in…" : "Sign in and view alerts"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
