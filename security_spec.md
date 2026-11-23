# Equinox-Books Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Sole Super User & Admin (`empresalhadiqainvest@gmail.com`)**: Only an authenticated Google user with `request.auth.token.email_verified == true` and `request.auth.token.email.lower() == 'empresalhadiqainvest@gmail.com'` holds the `superadmin` role (`isSuperAdmin()`). Every other user is strictly a standard `user`.
2. **Anti-Privilege-Escalation on `/users/{userId}`**: Regular users can only read/create/update their own `/users/{userId}` document with `role == 'user'`. Setting or escalating `role` to `'superadmin'` is strictly blocked unless `isSuperAdmin()`. Listing `/users` is restricted solely to `isSuperAdmin()`.
3. **Private Corporate CRM Template (`/crm_profiles/{userId}`)**: Each verified Google email account owns at most one `/crm_profiles/{userId}` document (`ownerUid == request.auth.uid`, `ownerEmail.lower() == request.auth.token.email.lower()`). Contains sensitive corporate PII (representative name, phone, WhatsApp, fiscal domicile, privacy settings) and is strictly isolated to the owner or `isSuperAdmin()`. Standard users CANNOT `get` or `list` another user's CRM profile.
4. **Tenant Isolation & Google Account Binding on `/companies/{companyId}`**: Every company MUST bind `ownerUid == request.auth.uid`, `googleAuthUid == request.auth.uid`, and `googleAuthEmail.lower() == request.auth.token.email.lower()` on creation, enforce valid SENIAT RIF format (`^[JVEGP]-[0-9]{8}-[0-9]$`), enforce `createdAt == request.time` on creation, preserve `ownerUid` and `createdAt` immutably on update, and enforce `updatedAt == request.time`. Only the owner (`ownerUid == request.auth.uid`) or `isSuperAdmin()` may read, list, update, or delete a company.
5. **Master Gate on `/companies/{companyId}/ledgers/{ledgerId}`**: Every ledger subdocument enforces the Master Gate against parent `/companies/{companyId}` (`ownerUid == request.auth.uid || isSuperAdmin()`), binds `ownerUid` and `companyId` immutably, and validates exact allowed keys, types, list size bounds, and `updatedAt == request.time`.
6. **No Shadow Fields**: Arbitrary keys are rejected on every collection via `keys().hasAll(...)`, `keys().hasOnly(...)`, and `diff(existing()).affectedKeys().hasOnly(...)`.

## 2. Dirty Dozen Payloads (Expected PERMISSION_DENIED)
1. Unauthenticated read or create on `/companies/emp-1` or `/crm_profiles/uid-1`.
2. User authenticated with `email_verified: false` (even with email `empresalhadiqainvest@gmail.com`) attempting read/write on `/users/{uid}`, `/crm_profiles/{uid}`, or `/companies` (Email Spoofing Test).
3. Non-admin user attempting to create or update `/users/{uid}` with `role: "superadmin"` (Privilege Escalation).
4. Authenticated standard user attempting to `list` `/users` or `/crm_profiles` collection (PII Leak).
5. Authenticated user A attempting to create `/crm_profiles/userB` or read `/crm_profiles/userB` (Cross-Account CRM Leak).
6. Authenticated user A attempting to create `/crm_profiles/userA` with spoofed `ownerEmail: "otro@empresa.com"` not matching their verified Google token email.
7. Authenticated user A attempting to create `/companies/emp-1` with `ownerUid: "user-B"` (Identity Spoofing).
8. Authenticated user attempting to inject a shadow field (`isAdmin: true`) into `/users/{uid}`, `/crm_profiles/{uid}`, or `/companies/emp-1`.
9. Oversized `companyId` or `userId` (`> 128` chars) or invalid characters in document ID (Path Poisoning).
10. Invalid Venezuelan RIF (`"123456"`) violating `^[JVEGP]-[0-9]{8}-[0-9]$` in `/companies` or `/crm_profiles`.
11. Client attempting to forge `createdAt` or `updatedAt` with a static timestamp instead of `request.time`, or mutate immutable `ownerUid`/`ownerEmail`/`createdAt`.
12. Standard User B attempting to write `/companies/emp-A/ledgers/main` even while claiming `ownerUid: userB` in the ledger body (Master Gate blocks mismatch with parent `companies/emp-A`).
