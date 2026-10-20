import { registrationOrigin } from "@/lib/registration-origin";

export type RegistrationDetails = {
  tokenId: string;
  deviceName?: string;
  locationId?: string;
  locationName?: string;
  backendUrl?: string;
  supabaseUrl?: string;
};

export function TerminalRegistrationDetails({ details }: { details: RegistrationDetails }) {
  const rows = [
    ["Terminal", details.deviceName || "This terminal"],
    ["Terminal ID", details.tokenId],
    ["Branch", details.locationName || details.locationId || "Not assigned"],
    ["POS backend", registrationOrigin(details.backendUrl)],
    ["Cloud database", registrationOrigin(details.supabaseUrl)],
  ];
  return <dl className="space-y-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
    {rows.map(([label, value]) => <div key={label} className="grid min-w-0 gap-0.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt><dd className="min-w-0 break-all font-medium">{value}</dd>
    </div>)}
  </dl>;
}
