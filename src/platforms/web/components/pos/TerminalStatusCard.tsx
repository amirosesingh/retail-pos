import { formatDateTime as posDisplayDateTime } from "@/lib/time-zone";
/**
 * Plain answer to "is this machine still a registered till, and is it running
 * the current software?" — so a counter never has to guess whether a strange
 * behaviour is old software or a failed check.
 */
import { APP_VERSION } from "@/version";
import { useRevocationCheck } from "@/lib/use-revocation-check";
import { TileGroup, TileRow } from "@/platforms/web/components/pos/AppUpdateSettings";

export function TerminalStatusCard() {
  const { config, revoked, reason, online, lastCheckedAt, verified } = useRevocationCheck();

  const answer = revoked
    ? reason === "missing"
      ? "Removed by management"
      : "Switched off by management"
    : !config
      ? "Not registered on this machine"
      : !online
        ? "No connection — kept working offline"
        : verified
          ? "Active"
          : "Asking…";

  return (
    <TileGroup title="Terminal status">
      <TileRow label="Software on this machine" value={<span className="numeric">v{APP_VERSION}</span>} />
      <TileRow
        label="Registration"
        value={<span className={revoked ? "text-destructive" : undefined}>{answer}</span>}
        hint={config?.locationName ? `Branch: ${config.locationName}` : undefined}
      />
      <TileRow
        label="Last checked"
        hint={
          lastCheckedAt
            ? posDisplayDateTime(new Date(lastCheckedAt))
            : "Not yet — it checks on start-up and every five minutes."
        }
      />
      {config?.tokenId && <TileRow label="Terminal ID" hint={config.tokenId} />}
    </TileGroup>
  );
}
