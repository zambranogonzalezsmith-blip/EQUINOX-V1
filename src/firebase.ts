import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  doc,
  type Firestore,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

function initFirebaseApp(): FirebaseApp {
  try {
    return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  } catch (err) {
    console.warn('Reutilizando instancia Firebase App tras advertencia:', err);
    return getApp();
  }
}

const app = initFirebaseApp();
const firestoreDatabaseId = (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;

function initFirestoreSafe(firebaseApp: FirebaseApp): Firestore {
  const tryInit = (settings: Parameters<typeof initializeFirestore>[1]): Firestore =>
    firestoreDatabaseId
      ? initializeFirestore(firebaseApp, settings, firestoreDatabaseId)
      : initializeFirestore(firebaseApp, settings);

  try {
    return tryInit({
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch {
    try {
      return tryInit({
        localCache: persistentLocalCache(),
      });
    } catch {
      try {
        return tryInit({
          localCache: memoryLocalCache(),
        });
      } catch {
        return firestoreDatabaseId
          ? getFirestore(firebaseApp, firestoreDatabaseId)
          : getFirestore(firebaseApp);
      }
    }
  }
}

export const db: Firestore = initFirestoreSafe(app);
export const auth: Auth = getAuth(app);

import {
  classifyFirestoreError,
  EquinoxFirestoreError,
  type FirestoreErrorInfo,
  OperationType,
} from './utils/firestoreErrors';

export {
  classifyFirestoreError,
  EquinoxFirestoreError,
  OperationType,
  type ClassifiedFirestoreError,
  type FirestoreErrorCategory,
  type FirestoreErrorInfo,
} from './utils/firestoreErrors';

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  if (error instanceof EquinoxFirestoreError) {
    throw error;
  }

  const classified = classifyFirestoreError(error);
  const errInfo: FirestoreErrorInfo = {
    error: classified.message,
    category: classified.category,
    code: classified.code,
    retryable: classified.retryable,
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

  if (classified.category === 'NETWORK_OFFLINE') {
    console.warn('Firestore Offline:', JSON.stringify(errInfo));
  } else {
    console.error('Firestore Error:', JSON.stringify(errInfo));
  }

  throw new EquinoxFirestoreError(JSON.stringify(errInfo), errInfo, classified);
}

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    const classified = classifyFirestoreError(error);
    if (classified.category === 'NETWORK_OFFLINE') {
      console.warn('Firestore en modo offline: operando sobre caché local persistente.');
      return false;
    }
    if (
      classified.category === 'PERMISSION_DENIED' ||
      classified.category === 'UNAUTHENTICATED'
    ) {
      return false;
    }
    return false;
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
