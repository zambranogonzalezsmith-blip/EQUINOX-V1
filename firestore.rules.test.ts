// Verification specification for Equinox-Books Firestore Security Rules (Eight Pillars)
export const DIRTY_DOZEN_SECURITY_CASES = [
  { id: 1, name: 'Unauthenticated read/write blocked across /companies and /crm_profiles', expected: 'PERMISSION_DENIED' },
  {
    id: 2,
    name: 'Unverified email spoofing empresalhadiqainvest@gmail.com blocked',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Standard user setting role="superadmin" blocked by anti-escalation rule',
    expected: 'PERMISSION_DENIED',
  },
  { id: 4, name: 'Non-admin list query on /users or /crm_profiles blocked (PII isolation)', expected: 'PERMISSION_DENIED' },
  { id: 5, name: 'Cross-account read/write on /crm_profiles/{otherUid} blocked', expected: 'PERMISSION_DENIED' },
  { id: 6, name: 'Spoofed ownerEmail in /crm_profiles not matching token email blocked', expected: 'PERMISSION_DENIED' },
  { id: 7, name: 'Spoofed ownerUid on Company create blocked', expected: 'PERMISSION_DENIED' },
  { id: 8, name: 'Shadow field (isAdmin: true) blocked by hasOnly', expected: 'PERMISSION_DENIED' },
  { id: 9, name: 'Invalid ID path (>128 chars or bad chars) blocked', expected: 'PERMISSION_DENIED' },
  { id: 10, name: 'Malformed Venezuelan RIF rejected by regex', expected: 'PERMISSION_DENIED' },
  { id: 11, name: 'Forged createdAt/updatedAt or immutable ownerUid/ownerEmail mutation rejected', expected: 'PERMISSION_DENIED' },
  { id: 12, name: 'Master Gate blocks write to ledger of another user company', expected: 'PERMISSION_DENIED' },
] as const;
