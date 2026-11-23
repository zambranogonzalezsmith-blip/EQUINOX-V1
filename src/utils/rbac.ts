export const SUPER_ADMIN_EMAIL = 'empresalhadiqainvest@gmail.com';

export type SystemRole = 'superadmin' | 'user';

export interface UserProfileRecord {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  activeCompanyId?: string;
  primaryCompanyId?: string;
  crmCompleted?: boolean;
  role: SystemRole;
  createdAt: string;
  updatedAt: string;
}

export function normalizeEmail(email?: string | null): string {
  return (email || '').trim().toLowerCase();
}

export function isSuperAdminEmail(email?: string | null): boolean {
  return normalizeEmail(email) === SUPER_ADMIN_EMAIL;
}

export function resolveUserRole(
  email?: string | null,
  emailVerified?: boolean | null
): SystemRole {
  if (emailVerified && isSuperAdminEmail(email)) {
    return 'superadmin';
  }
  return 'user';
}
