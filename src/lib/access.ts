// Who can reach what in Wally. Shared by the console (client) and the
// server-side people functions, so it holds no server imports.

export type AccessRole = "platform_admin" | "agency_admin" | "tenant_admin" | "tenant_staff";

export const ACCESS_ROLES: { role: AccessRole; label: string; hint: string; needs: "none" | "agency" | "tenant" }[] = [
  { role: "platform_admin", label: "Wally team", hint: "Everything: every business, agency, person and setting.", needs: "none" },
  { role: "agency_admin", label: "Agency admin", hint: "Their agency and its client businesses.", needs: "agency" },
  { role: "tenant_admin", label: "Business admin", hint: "One business: its AI staff, settings and people.", needs: "tenant" },
  { role: "tenant_staff", label: "Business staff", hint: "One business: can view and use it, not change settings.", needs: "tenant" },
];

export type Access = { id: string; role: AccessRole; tenantId: string | null; agencyId: string | null };
export type Person = { id: string; email: string; createdAt: string; lastSignInAt: string | null; access: Access[] };
