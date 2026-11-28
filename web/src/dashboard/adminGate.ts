/**
 * The dashboard mirrors the server's write gate: hide edit controls only when the server actually
 * requires ADMIN_TOKEN and this browser has not stored one. Servers without the gate keep the full UI.
 */
export function isAdminLocked(adminRequired: boolean | undefined, token: string): boolean {
  return adminRequired === true && token.trim() === "";
}
