export const ORG_ROLES = ["owner", "admin", "responder", "viewer"] as const;

export type OrgRole = (typeof ORG_ROLES)[number];

const roleRank: Record<OrgRole, number> = {
  owner: 4,
  admin: 3,
  responder: 2,
  viewer: 1,
};

export function hasRoleAtLeast(role: OrgRole, minimumRole: OrgRole) {
  return roleRank[role] >= roleRank[minimumRole];
}

export function canManageOperationalConfig(role: OrgRole) {
  return hasRoleAtLeast(role, "admin");
}

export function canManageIncidents(role: OrgRole) {
  return hasRoleAtLeast(role, "responder");
}
