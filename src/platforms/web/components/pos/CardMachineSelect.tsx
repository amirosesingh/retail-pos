import { Input } from "@/components/ui/input";
import { usePos } from "@/lib/pos-store";
import { availableCardMachines, cardMachineLabel } from "@/lib/card-machines";
import { ThemedSelect } from "./ThemedSelect";

export function CardMachineSelect({
  accountId,
  bankName,
  onChange,
}: {
  accountId?: string;
  bankName: string;
  onChange: (value: { accountId: string; bankName: string }) => void;
}) {
  const { state, currentStore } = usePos();
  const machines = availableCardMachines(
    state.settings.integrations.paymentAccounts,
    currentStore.id,
  );
  if (!machines.length)
    return (
      <Input
        aria-label="Bank or card machine"
        value={bankName}
        placeholder="Bank / machine (configure a list in Payment accounts)"
        onChange={(event) => onChange({ accountId: "", bankName: event.target.value })}
      />
    );
  const selected = machines.find((machine) => machine.id === accountId);
  return (
    <div className="space-y-1">
      <ThemedSelect
        ariaLabel="Bank / card machine used"
        value={selected?.id ?? ""}
        placeholder="Select the card machine / bank"
        options={machines.map((machine) => ({
          value: machine.id,
          label: cardMachineLabel(machine),
        }))}
        onChange={(id) => {
          const machine = machines.find((candidate) => candidate.id === id);
          onChange({
            accountId: machine?.id ?? "",
            bankName: machine ? cardMachineLabel(machine) : "",
          });
        }}
      />
      {!!selected?.acceptedCards?.length && (
        <p className="text-xs text-muted-foreground">Accepts {selected.acceptedCards.join(", ")}</p>
      )}
    </div>
  );
}
