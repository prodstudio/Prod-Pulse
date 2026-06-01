export const ORG_ROLES = ["owner", "admin", "responder", "viewer"] as const;

export type OrgRole = (typeof ORG_ROLES)[number];

const ROLE_RANK: Record<OrgRole, number> = {
  owner: 4,
  admin: 3,
  responder: 2,
  viewer: 1,
};

export function hasRoleAtLeast(currentRole: OrgRole, minimumRole: OrgRole) {
  return ROLE_RANK[currentRole] >= ROLE_RANK[minimumRole];
}

export function canManageOperationalConfig(role: OrgRole) {
  return hasRoleAtLeast(role, "admin");
}

export function canManageIncidents(role: OrgRole) {
  return hasRoleAtLeast(role, "responder");
}

export function canReadOrganization(role: OrgRole) {
  return ORG_ROLES.includes(role);
}
