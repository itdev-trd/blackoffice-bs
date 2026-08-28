import { canAccessAccount, type UserPermission } from "./permissions.ts";

export async function canAccessMetaNodes(
  permission: UserPermission,
  token: string,
  nodeIds: unknown[],
  graphVersion = "v22.0",
): Promise<boolean> {
  if (permission.role === "admin") return true;
  if (!permission.allowed.length) return false;

  const ids = [...new Set(nodeIds.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, 50);
  if (!ids.length) return false;

  for (const id of ids) {
    const url = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(id)}?fields=account_id&access_token=${encodeURIComponent(token)}`;
    const response = await fetch(url);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.error || !canAccessAccount(permission, data?.account_id)) return false;
  }
  return true;
}
