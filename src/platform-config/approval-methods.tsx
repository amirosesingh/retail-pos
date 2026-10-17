/** Native-only administration controls: never render in the website. */
export type ApprovalMethodPerson = {
  user_id: string;
  approval_pin_enabled: boolean;
  approval_totp_enabled: boolean;
};
export function NativeApprovalMethods(_props: {
  person: ApprovalMethodPerson | null;
  disabled: boolean;
  onUpdated: (
    userId: string,
    patch: Pick<ApprovalMethodPerson, "approval_pin_enabled" | "approval_totp_enabled">,
  ) => void;
}) {
  return null;
}
