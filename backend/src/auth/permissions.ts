import type { StaffRole } from '../db/schema.js';

/** Who may do what. The server checks this on every request; the admin panel only mirrors it. */
const PERMISSIONS = {
  'bookings.manage': ['owner', 'manager', 'front_desk'],
  'customers.manage': ['owner', 'manager', 'front_desk'],
  'enquiries.manage': ['owner', 'manager', 'front_desk'],
  'messages.manage': ['owner', 'manager', 'front_desk'],
  'memberships.view': ['owner', 'manager', 'front_desk'],
  'memberships.manage': ['owner', 'manager'],
  'payments.view': ['owner', 'manager'],
  'payments.record': ['owner', 'manager', 'front_desk'],
  'payments.void': ['owner', 'manager'],
  'reports.view': ['owner', 'manager'],
  'refunds.manage': ['owner'],
  'website.manage': ['owner', 'manager'],
  'settings.manage': ['owner'],
  'staff.manage': ['owner'],
} as const satisfies Record<string, readonly StaffRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export const can = (role: StaffRole, permission: Permission) => (PERMISSIONS[permission] as readonly StaffRole[]).includes(role);

export const permissionsFor = (role: StaffRole) => (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
