export function iosInstallSafe(input: {
  pathname: string;
  confirmedPath: string | null;
  edited: boolean;
  visible: boolean;
  blocked: boolean;
  transactionSafe: boolean;
}): boolean {
  return (input.pathname === "/settings/updates" || input.pathname === input.confirmedPath) &&
    input.visible && !input.edited && !input.blocked && input.transactionSafe;
}
