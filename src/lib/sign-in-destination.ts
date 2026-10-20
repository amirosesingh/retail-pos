/** Select a landing page without changing permissions or overriding an active session. */
export function signInDestination(isAdmin: boolean, canViewDashboard: boolean, dashboardVisible: boolean): "/" | "/dashboard" {
  return isAdmin && canViewDashboard && dashboardVisible ? "/dashboard" : "/";
}
