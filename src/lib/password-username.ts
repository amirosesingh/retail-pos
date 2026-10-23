/** A leading @ explicitly selects the password account; bare names keep PIN sign-in. */
export const PASSWORD_USERNAME = /^@([a-z0-9._-]{2,40})$/i;

export function passwordUsername(identifier: string): string | null {
  const match = PASSWORD_USERNAME.exec(identifier.trim());
  return match ? match[1]!.toLowerCase() : null;
}

/** The validated alphabet cannot inject PostgREST filter syntax. */
export function passwordUsernameLookup(username: string): string {
  if (!/^[a-z0-9._-]{2,40}$/.test(username)) throw new Error("Invalid username");
  return `app_users?select=email,auth_user_id,is_active&or=(login_username.eq.${username},user_id.eq.${username})&limit=2`;
}
