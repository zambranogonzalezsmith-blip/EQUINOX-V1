export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export type FirestoreErrorCategory =
  | 'PERMISSION_DENIED'
  | 'UNAUTHENTICATED'
  | 'NETWORK_OFFLINE'
  | 'NOT_FOUND'
  | 'QUOTA_EXCEEDED'
  | 'INVALID_ARGUMENT'
  | 'CONFLICT'
  | 'INTERNAL';

export interface ClassifiedFirestoreError {
  category: FirestoreErrorCategory;
  code: string;
  message: string;
  userMessage: string;
  retryable: boolean;
  httpStatus: number;
}

export interface FirestoreErrorInfo {
  error: string;
  category?: FirestoreErrorCategory;
  code?: string;
  retryable?: boolean;
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

export class EquinoxFirestoreError extends Error {
  readonly info: FirestoreErrorInfo;
  readonly classified: ClassifiedFirestoreError;

  constructor(
    serializedMessage: string,
    info: FirestoreErrorInfo,
    classified: ClassifiedFirestoreError
  ) {
    super(serializedMessage);
    this.name = 'EquinoxFirestoreError';
    this.info = info;
    this.classified = classified;
  }
}

export function classifyFirestoreError(error: unknown): ClassifiedFirestoreError {
  if (error instanceof EquinoxFirestoreError) {
    return error.classified;
  }

  const errObj = (typeof error === 'object' && error !== null ? error : {}) as {
    code?: unknown;
    message?: unknown;
    status?: unknown;
  };

  let rawCode = typeof errObj.code === 'string' ? errObj.code.trim().toLowerCase() : '';
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof errObj.message === 'string'
        ? errObj.message
        : String(error || 'Error desconocido de Firestore');

  // Si ya viene serializado como FirestoreErrorInfo JSON, extraer su código/error interno
  if (rawMessage.startsWith('{') && rawMessage.includes('"operationType"')) {
    try {
      const parsed = JSON.parse(rawMessage) as Partial<FirestoreErrorInfo>;
      if (parsed.code && !rawCode) {
        rawCode = String(parsed.code).toLowerCase();
      }
      if (parsed.category) {
        return {
          category: parsed.category,
          code: rawCode || parsed.category.toLowerCase(),
          message: parsed.error || rawMessage,
          userMessage: parsed.error || rawMessage,
          retryable: Boolean(parsed.retryable),
          httpStatus:
            parsed.category === 'PERMISSION_DENIED'
              ? 403
              : parsed.category === 'UNAUTHENTICATED'
                ? 401
                : parsed.category === 'NETWORK_OFFLINE'
                  ? 503
                  : 500,
        };
      }
    } catch {
      // continuar con clasificación por texto/código
    }
  }

  const normalizedCode = rawCode.replace(/^firestore\//, '');
  const msgLower = rawMessage.toLowerCase();

  if (
    normalizedCode === 'permission-denied' ||
    normalizedCode === 'permission_denied' ||
    msgLower.includes('missing or insufficient permissions') ||
    msgLower.includes('permission_denied') ||
    errObj.status === 403
  ) {
    return {
      category: 'PERMISSION_DENIED',
      code: normalizedCode || 'permission-denied',
      message: rawMessage,
      userMessage: 'Permisos insuficientes en Firestore para esta operación o empresa.',
      retryable: false,
      httpStatus: 403,
    };
  }

  if (
    normalizedCode === 'unauthenticated' ||
    msgLower.includes('unauthenticated') ||
    msgLower.includes('auth token') ||
    errObj.status === 401
  ) {
    return {
      category: 'UNAUTHENTICATED',
      code: normalizedCode || 'unauthenticated',
      message: rawMessage,
      userMessage: 'Tu sesión de Google expiró o no está verificada. Inicia sesión nuevamente.',
      retryable: false,
      httpStatus: 401,
    };
  }

  if (
    normalizedCode === 'unavailable' ||
    normalizedCode === 'deadline-exceeded' ||
    normalizedCode === 'cancelled' ||
    normalizedCode === 'aborted' ||
    msgLower.includes('client is offline') ||
    msgLower.includes('offline') ||
    msgLower.includes('network') ||
    msgLower.includes('failed to fetch') ||
    msgLower.includes('unavailable') ||
    errObj.status === 503
  ) {
    return {
      category: 'NETWORK_OFFLINE',
      code: normalizedCode || 'unavailable',
      message: rawMessage,
      userMessage: 'Sin conexión estable con Cloud Firestore. Los cambios permanecen seguros en IndexedDB y se sincronizarán al reconectar.',
      retryable: true,
      httpStatus: 503,
    };
  }

  if (
    normalizedCode === 'resource-exhausted' ||
    msgLower.includes('resource_exhausted') ||
    msgLower.includes('quota') ||
    errObj.status === 429
  ) {
    return {
      category: 'QUOTA_EXCEEDED',
      code: normalizedCode || 'resource-exhausted',
      message: rawMessage,
      userMessage: 'Se alcanzó temporalmente la cuota de operaciones en Firestore. Intenta nuevamente en unos segundos.',
      retryable: true,
      httpStatus: 429,
    };
  }

  if (normalizedCode === 'not-found' || errObj.status === 404) {
    return {
      category: 'NOT_FOUND',
      code: normalizedCode || 'not-found',
      message: rawMessage,
      userMessage: 'El documento o libro contable solicitado no existe en Firestore.',
      retryable: false,
      httpStatus: 404,
    };
  }

  if (
    normalizedCode === 'already-exists' ||
    msgLower.includes('already exists') ||
    errObj.status === 409
  ) {
    return {
      category: 'CONFLICT',
      code: normalizedCode || 'already-exists',
      message: rawMessage,
      userMessage: 'Conflicto de versión o identificador duplicado en Firestore.',
      retryable: false,
      httpStatus: 409,
    };
  }

  if (
    normalizedCode === 'invalid-argument' ||
    normalizedCode === 'out-of-range' ||
    normalizedCode === 'failed-precondition' ||
    msgLower.includes('invalid argument') ||
    msgLower.includes('failed precondition') ||
    errObj.status === 400
  ) {
    return {
      category: 'INVALID_ARGUMENT',
      code: normalizedCode || 'invalid-argument',
      message: rawMessage,
      userMessage: 'Los datos enviados no cumplen la validación o el índice requerido por Firestore.',
      retryable: false,
      httpStatus: 400,
    };
  }

  return {
    category: 'INTERNAL',
    code: normalizedCode || 'internal',
    message: rawMessage,
    userMessage: 'Error inesperado al comunicarse con Cloud Firestore.',
    retryable: false,
    httpStatus: 500,
  };
}
