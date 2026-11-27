import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { BookOpen, Crown, LogOut, ShieldCheck, UserCheck, WifiOff, X } from 'lucide-react';
import { PROJECT_METADATA } from '../utils/licenseCrypto';
import { resolveUserRole } from '../utils/rbac';

interface SplashPresentationProps {
  visible: boolean;
  googleUser: User | null;
  authLoading: boolean;
  authPending: boolean;
  authError: string | null;
  isOnline: boolean;
  simulatedOffline?: boolean;
  onGoogleSignIn: () => Promise<void>;
  onSwitchGoogleAccount: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onEnterSystem: () => void;
}

const TITLE_WORDS = ['EQUINOX', 'BOOKS'];

export const SplashPresentation: React.FC<SplashPresentationProps> = ({
  visible,
  googleUser,
  authLoading,
  authPending,
  authError,
  isOnline,
  simulatedOffline = false,
  onGoogleSignIn,
  onSwitchGoogleAccount,
  onSignOut,
  onEnterSystem,
}) => {
  const [loadProgress, setLoadProgress] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setLoadProgress(12);
    const t1 = setTimeout(() => setLoadProgress(48), 180);
    const t2 = setTimeout(() => setLoadProgress(82), 520);
    const t3 = setTimeout(() => setLoadProgress(100), 980);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [visible]);

  if (!visible) return null;

  const isLoaded = loadProgress >= 100;
  const userRole = googleUser
    ? resolveUserRole(googleUser.email, googleUser.emailVerified)
    : null;
  const isSuperAdmin = userRole === 'superadmin';
  const browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
  const canAttemptGoogleSignIn = !simulatedOffline && (isOnline || browserOnline);

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center overflow-y-auto p-4 sm:p-6"
      style={{
        background: 'radial-gradient(circle at 50% 30%, #16223d 0%, #0a0f1d 60%, #050811 100%)',
      }}
    >
      <div
        className="eqx-splash-card relative my-auto w-full max-w-[860px] rounded-[14px] border border-[#c5a059] px-6 py-10 text-center sm:px-10 sm:py-12"
        style={{
          background: 'rgba(10, 15, 29, 0.86)',
          boxShadow:
            '0 0 90px rgba(197, 160, 89, 0.16), inset 0 0 60px rgba(197, 160, 89, 0.05)',
        }}
      >
        {/* Acceso inmediato sin bloqueos */}
        <button
          type="button"
          onClick={onEnterSystem}
          className="absolute right-4 top-4 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#2a3b5c] bg-[#141e33] px-3 py-1.5 text-xs font-semibold text-[#e5c178] transition-colors hover:border-[#c5a059] hover:bg-[#1e2c4a]"
          title="Cerrar presentación e ingresar directamente a los libros contables"
        >
          <BookOpen className="h-3.5 w-3.5" />
          Ir a los Libros
          <X className="h-3.5 w-3.5" />
        </button>

        {/* Sello Oficial */}
        <div className="eqx-seal mb-5 h-[92px] w-[92px] text-[1.8rem] tracking-[2px]">
          &#9878;
        </div>

        {/* Casa Matriz */}
        <div>
          <div className="mb-6 inline-block border-b border-[#2a3b5c] px-6 pb-3 font-serif text-sm tracking-[8px] text-[#e5c178] uppercase sm:px-9 sm:text-base sm:tracking-[10px]">
            {PROJECT_METADATA.propietario}
          </div>
        </div>

        {/* Palabra EQUINOX BOOKS con secuencia progresiva de carga e iluminación */}
        <h1
          aria-label="Equinox Books"
          className="m-0 font-serif text-3xl font-bold tracking-[6px] uppercase sm:text-[3.4rem] sm:tracking-[12px]"
        >
          {TITLE_WORDS.map((word, wIdx) => (
            <span key={word} className={wIdx === 0 ? 'mr-3 inline-block sm:mr-5' : 'inline-block'}>
              {word.split('').map((char, cIdx) => {
                const index = wIdx * 8 + cIdx;
                return (
                  <span
                    key={`${word}-${cIdx}`}
                    className="eqx-letter"
                    style={{ animationDelay: `${index * 65}ms` }}
                  >
                    {char}
                  </span>
                );
              })}
            </span>
          ))}
        </h1>

        <p className="mt-3.5 text-xs tracking-[4px] text-[#94a3b8] uppercase sm:tracking-[6px]">
          Sistema Contable y Auditoría Fiscal de Alta Gama
        </p>

        {/* Indicador de carga inicial del motor contable */}
        <div className="mx-auto mt-5 max-w-md">
          <div className="h-[2px] w-full overflow-hidden rounded-full bg-[#1e2c4a]">
            <div
              className="h-full bg-gradient-to-r from-[#8a6d33] via-[#e5c178] to-[#c5a059] transition-all duration-500"
              style={{ width: `${loadProgress}%` }}
            />
          </div>
          <p className="mt-2 font-mono-tabular text-[11px] text-[#94a3b8]">
            {isLoaded
              ? 'Motor Cero-Float · Catálogo NIC / VEN-NIF · Seguridad Multi-Empresa Verificada'
              : `Cargando Equinox Books (${loadProgress}%)...`}
          </p>
        </div>

        <div
          className="mx-auto my-6 h-[1px] w-[140px]"
          style={{
            background: 'linear-gradient(90deg, transparent, #c5a059, transparent)',
          }}
        />

        {/* Declaración Legal Oficial */}
        <p className="mx-auto max-w-[660px] font-serif text-sm leading-[1.85] italic text-[#f1f5f9] sm:text-[0.95rem]">
          <strong className="not-italic text-[#e5c178]">Smith Business Solution 2026</strong>, en
          ejercicio de sus facultades de desarrollo de software corporativo, presenta oficialmente{' '}
          <strong className="not-italic text-[#e5c178]">Equinox Books</strong>: solución contable de
          alta gama con validación de partida doble, auditoría fiscal en tiempo real y firma de
          patente{' '}
          <strong className="not-italic text-[#e5c178]">SBS-2026-EQX-BOOKS-PATENT-REGISTERED</strong>,
          en cumplimiento de los estándares contables internacionales{' '}
          <strong className="not-italic text-[#e5c178]">NIC</strong>.
        </p>

        <p className="mt-5 text-[11px] tracking-[1.5px] leading-[1.95] text-[#94a3b8] uppercase">
          Propiedad Oficial &middot; {PROJECT_METADATA.propietario}
          <br />
          Creador Principal &middot; {PROJECT_METADATA.creador}
          <br />
          Fecha de Registro &middot; {PROJECT_METADATA.fecha_creacion} &middot; Multi-Empresa NIC
          <br />
          Contacto &middot; {PROJECT_METADATA.contacto}
        </p>

        {/* Configuración NIC y Servicios Activos */}
        <div className="mx-auto mt-5 grid max-w-2xl grid-cols-2 gap-2 text-left text-[11px] sm:grid-cols-4">
          <div className="rounded border border-[#2a3b5c] bg-[#0d1527]/80 px-2.5 py-2">
            <span className="block font-semibold text-[#e5c178]">Partida Doble</span>
            <span className="text-[#94a3b8]">Motor Cero-Float</span>
          </div>
          <div className="rounded border border-[#2a3b5c] bg-[#0d1527]/80 px-2.5 py-2">
            <span className="block font-semibold text-[#e5c178]">Normativa NIC</span>
            <span className="text-[#94a3b8]">NIC 1 · 2 · 7 · 16 · 21</span>
          </div>
          <div className="rounded border border-[#2a3b5c] bg-[#0d1527]/80 px-2.5 py-2">
            <span className="block font-semibold text-[#e5c178]">Fiscal SENIAT</span>
            <span className="text-[#94a3b8]">IVA · ISLR · IGTF</span>
          </div>
          <div className="rounded border border-[#2a3b5c] bg-[#0d1527]/80 px-2.5 py-2">
            <span className="block font-semibold text-[#e5c178]">Nube &amp; Offline</span>
            <span className="text-[#94a3b8]">Firestore · Drive · PWA</span>
          </div>
        </div>

        {/* Gate de Autenticación con Google por Empresa / Corporación */}
        <div className="mx-auto mt-7 max-w-lg rounded-lg border border-[#2a3b5c] bg-[#0d1527]/90 p-5">
          {authLoading ? (
            <div className="space-y-3">
              <p className="text-xs text-[#94a3b8]">Verificando sesión corporativa de Google...</p>
              <button
                type="button"
                onClick={onEnterSystem}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#2a3b5c] bg-[#141e33] px-4 py-2 text-xs font-semibold text-[#e5c178] hover:border-[#c5a059]"
              >
                <BookOpen className="h-3.5 w-3.5" />
                Ingresar Directamente a los Libros
              </button>
            </div>
          ) : googleUser ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-center gap-3">
                {googleUser.photoURL ? (
                  <img
                    src={googleUser.photoURL}
                    alt={googleUser.displayName || 'Cuenta Google'}
                    referrerPolicy="no-referrer"
                    className="h-10 w-10 rounded-full border border-[#c5a059]"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#c5a059] bg-[#141e33] text-sm font-bold text-[#e5c178]">
                    {(googleUser.displayName || googleUser.email || 'G').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Sesión Google Verificada
                    </span>
                    {isSuperAdmin ? (
                      <span className="inline-flex items-center gap-1 rounded border border-[#c5a059] bg-[#c5a059]/20 px-2 py-0.5 text-[10px] font-bold tracking-wider text-[#e5c178] uppercase">
                        <Crown className="h-3 w-3" />
                        Super Usuario · Admin Global
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded border border-[#2a3b5c] bg-[#141e33] px-2 py-0.5 text-[10px] font-semibold tracking-wider text-slate-300 uppercase">
                        <UserCheck className="h-3 w-3 text-emerald-400" />
                        Usuario Estándar
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm font-bold text-[#f1f5f9]">
                    {googleUser.displayName || 'Usuario Corporativo'}
                  </p>
                  <p className="font-mono-tabular text-xs text-[#94a3b8]">{googleUser.email}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={onEnterSystem}
                  className="cursor-pointer rounded-md bg-[#c5a059] px-8 py-3 font-serif text-sm font-bold tracking-[2.5px] text-black uppercase transition-colors hover:bg-[#e5c178]"
                >
                  Ingresar a los Libros
                </button>
                <button
                  type="button"
                  onClick={() => void onSwitchGoogleAccount()}
                  disabled={authPending}
                  className="cursor-pointer rounded-md border border-[#2a3b5c] bg-[#141e33] px-4 py-3 text-xs font-semibold text-[#f1f5f9] hover:border-[#c5a059]/60"
                >
                  Cambiar Cuenta Google
                </button>
                <button
                  type="button"
                  onClick={() => void onSignOut()}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-3 text-xs text-[#94a3b8] hover:text-rose-400"
                  title="Cerrar sesión Google"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-[#94a3b8]">
                Cada empresa registrada en <strong className="text-[#e5c178]">Equinox Books</strong>{' '}
                se autentica y resguarda mediante su cuenta de <strong className="text-[#f1f5f9]">Google</strong>.
              </p>

              {authError && (
                <div className="rounded border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">
                  <p>{authError}</p>
                  <p className="mt-1 text-[11px] text-rose-200/80">
                    Puedes reintentar el acceso con Google o ingresar directamente al modo local/offline sin perder datos.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => void onGoogleSignIn()}
                  disabled={authPending || !canAttemptGoogleSignIn}
                  className="inline-flex cursor-pointer items-center gap-2.5 rounded-md bg-[#c5a059] px-7 py-3 font-serif text-sm font-bold tracking-[1.5px] text-black uppercase transition-colors hover:bg-[#e5c178] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#111827"
                      d="M21.35 11.1h-9.17v2.98h5.27c-.23 1.45-1.69 4.25-5.27 4.25-3.17 0-5.76-2.62-5.76-5.85s2.59-5.85 5.76-5.85c1.81 0 3.02.77 3.71 1.44l2.53-2.44C16.8 4.12 14.69 3.2 12.18 3.2 7.21 3.2 3.18 7.23 3.18 12.2s4.03 9 9 9c5.19 0 8.64-3.65 8.64-8.79 0-.59-.06-1.04-.14-1.31z"
                    />
                  </svg>
                  {authPending
                    ? 'Autenticando con Google...'
                    : authError
                      ? 'Reintentar con Google'
                      : 'Autenticar con Google e Ingresar'}
                </button>

                <button
                  type="button"
                  onClick={onEnterSystem}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[#c5a059]/60 bg-[#141e33] px-5 py-3 text-xs font-bold text-[#e5c178] transition-colors hover:bg-[#1e2c4a] hover:text-[#f1f5f9]"
                >
                  {!canAttemptGoogleSignIn ? (
                    <WifiOff className="h-3.5 w-3.5 text-amber-400" />
                  ) : (
                    <BookOpen className="h-3.5 w-3.5 text-[#c5a059]" />
                  )}
                  {canAttemptGoogleSignIn
                    ? 'Ingresar Directamente a los Libros'
                    : 'Ingresar a los Libros (Modo Offline)'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Enlaces Legales Públicos (Cumplimiento Web & Google OAuth) */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-4 text-[11px] text-[#94a3b8]">
          <a
            href={`${import.meta.env.BASE_URL}privacidad.html`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[#e5c178] hover:underline"
          >
            Política de Privacidad
          </a>
          <span>&middot;</span>
          <a
            href={`${import.meta.env.BASE_URL}terminos.html`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[#e5c178] hover:underline"
          >
            Términos y Condiciones
          </a>
          <span>&middot;</span>
          <a
            href={`${import.meta.env.BASE_URL}aviso-legal.html`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[#e5c178] hover:underline"
          >
            Aviso Legal y Cookies
          </a>
        </div>
      </div>
    </div>
  );
};
