/** Soft tokens identify their owner; a PIN can confirm the signed-in account. */
export function approvalIdentity(tokenOnly: boolean, authorizerId: string, selfAuthorizerId?: string) {
  return tokenOnly
    ? { authorizerId: "", selfAuthorization: false }
    : { authorizerId: selfAuthorizerId ?? authorizerId.trim(), selfAuthorization: !!selfAuthorizerId };
}
