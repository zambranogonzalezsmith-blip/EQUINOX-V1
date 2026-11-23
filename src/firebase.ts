import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

const firestoreDatabaseId = (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;
const firestoreSettings = {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
};

export const db = firestoreDatabaseId
  ? initializeFirestore(app, firestoreSettings, firestoreDatabaseId)
  : initializeFirestore(app, firestoreSettings);

export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore en modo offline: operando sobre caché local persistente.');
      return false;
    }
    return true;
  }
}

export const SCOPES = ['https://www.googleapis.com/auth/drive.file'] as const;

// Token OAuth almacenado estrictamente en memoria JS (nunca en localStorage ni sessionStorage)
let cachedDriveAccessToken: string | null = null;
let cachedDriveTokenUid: string | null = null;
let cachedDriveTokenEmail: string | null = null;
let cachedDriveTokenExpiresAt = 0;

export function setCachedDriveAccessToken(user: User, token: string): void {
  cachedDriveAccessToken = token;
  cachedDriveTokenUid = user.uid;
  cachedDriveTokenEmail = (user.email || '').toLowerCase();
  cachedDriveTokenExpiresAt = Date.now() + 50 * 60 * 1000;
}

export function clearCachedDriveAccessToken(): void {
  cachedDriveAccessToken = null;
  cachedDriveTokenUid = null;
  cachedDriveTokenEmail = null;
  cachedDriveTokenExpiresAt = 0;
}

export function syncDriveTokenWithAuthUser(user: User | null): void {
  if (!user) {
    clearCachedDriveAccessToken();
    return;
  }
  const normalizedEmail = (user.email || '').toLowerCase();
  if (
    cachedDriveTokenUid !== user.uid ||
    (cachedDriveTokenEmail && normalizedEmail && cachedDriveTokenEmail !== normalizedEmail)
  ) {
    clearCachedDriveAccessToken();
  }
}

export function getDriveAccessTokenForUser(
  uid?: string | null,
  email?: string | null
): string | null {
  if (!cachedDriveAccessToken || !uid) return null;
  if (Date.now() >= cachedDriveTokenExpiresAt) {
    clearCachedDriveAccessToken();
    return null;
  }
  if (cachedDriveTokenUid !== uid) return null;
  const normalizedEmail = (email || '').toLowerCase();
  if (normalizedEmail && cachedDriveTokenEmail && cachedDriveTokenEmail !== normalizedEmail) {
    return null;
  }
  return cachedDriveAccessToken;
}

function createGoogleProvider(
  includeDriveScope: boolean,
  promptValue?: string,
  loginHint?: string
): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.addScope('email');
  provider.addScope('profile');
  if (includeDriveScope) {
    for (const scope of SCOPES) {
      provider.addScope(scope);
    }
  }
  const params: Record<string, string> = {};
  if (promptValue) {
    params.prompt = promptValue;
  }
  if (loginHint) {
    params.login_hint = loginHint;
  }
  if (Object.keys(params).length > 0) {
    provider.setCustomParameters(params);
  }
  return provider;
}

export async function signInWithGoogle(
  forceSelectAccount = true,
  loginHint?: string
): Promise<User> {
  const provider = createGoogleProvider(
    true,
    forceSelectAccount ? 'select_account' : undefined,
    loginHint
  );
  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (credential?.accessToken) {
    setCachedDriveAccessToken(result.user, credential.accessToken);
  }
  return result.user;
}

export async function connectGoogleDriveForUser(
  expectedUser?: User | null
): Promise<{ user: User; accessToken: string }> {
  const provider = createGoogleProvider(
    true,
    expectedUser?.email ? 'consent' : 'select_account',
    expectedUser?.email || undefined
  );
  const result = await signInWithPopup(auth, provider);

  if (expectedUser && result.user.uid !== expectedUser.uid) {
    clearCachedDriveAccessToken();
    throw new Error(
      `La cuenta seleccionada (${result.user.email || result.user.uid}) no coincide con la sesión activa (${expectedUser.email || expectedUser.uid}). Selecciona ${expectedUser.email} para respaldar su Drive personal.`
    );
  }

  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error(
      'No se recibió el permiso temporal de Google Drive. Intenta nuevamente aceptando el acceso.'
    );
  }

  setCachedDriveAccessToken(result.user, credential.accessToken);
  return { user: result.user, accessToken: credential.accessToken };
}

export async function signOutGoogle(): Promise<void> {
  clearCachedDriveAccessToken();
  await signOut(auth);
}

void testFirestoreConnection();
