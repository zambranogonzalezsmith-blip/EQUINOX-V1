/**
 * Traduce códigos de error de Firebase Authentication a mensajes claros y accionables en español.
 */
export function formatFirebaseAuthError(error: unknown, hostname?: string): string {
  const errObj = (typeof error === 'object' && error !== null ? error : {}) as {
    code?: unknown;
    message?: unknown;
  };

  const rawCode = typeof errObj.code === 'string' ? errObj.code.trim().toLowerCase() : '';
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof errObj.message === 'string'
        ? errObj.message
        : String(error || 'Error desconocido al iniciar sesión con Google.');

  const msgLower = rawMessage.toLowerCase();
  const hostLabel = hostname?.trim() || 'este dominio';

  if (rawCode === 'auth/unauthorized-domain' || msgLower.includes('unauthorized-domain')) {
    return `El dominio "${hostLabel}" no está autorizado en Firebase Authentication. Agrégalo en Firebase Console → Authentication → Settings → Authorized domains.`;
  }

  if (rawCode === 'auth/popup-blocked' || msgLower.includes('popup-blocked')) {
    return 'El navegador bloqueó la ventana emergente de Google. Habilita las ventanas emergentes para este sitio e intenta nuevamente.';
  }

  if (rawCode === 'auth/popup-closed-by-user' || msgLower.includes('popup-closed-by-user')) {
    return 'Cerraste la ventana de inicio de sesión de Google antes de completar el acceso.';
  }

  if (
    rawCode === 'auth/cancelled-popup-request' ||
    msgLower.includes('cancelled-popup-request')
  ) {
    return 'Se canceló una solicitud de inicio de sesión previa. Haz clic una sola vez para autenticar.';
  }

  if (
    rawCode === 'auth/network-request-failed' ||
    msgLower.includes('network-request-failed')
  ) {
    return 'No se pudo conectar con Google Auth por un fallo de red. Verifica tu conexión o ingresa en Modo Offline.';
  }

  if (
    rawCode === 'auth/operation-not-supported-in-this-environment' ||
    msgLower.includes('operation-not-supported-in-this-environment')
  ) {
    return 'Este entorno restringe la ventana emergente de autenticación. Abre la aplicación en una pestaña estándar de Chrome, Edge o Safari.';
  }

  if (rawCode === 'auth/user-disabled' || msgLower.includes('user-disabled')) {
    return 'Esta cuenta de Google ha sido deshabilitada en la configuración de acceso.';
  }

  if (
    rawCode === 'auth/account-exists-with-different-credential' ||
    msgLower.includes('account-exists-with-different-credential')
  ) {
    return 'Ya existe una cuenta registrada con otro método de acceso para este correo.';
  }

  if (rawCode === 'auth/internal-error' || msgLower.includes('auth/internal-error')) {
    return 'Error interno temporal al comunicar con Google Authentication. Intenta nuevamente en unos segundos.';
  }

  return rawMessage;
}
