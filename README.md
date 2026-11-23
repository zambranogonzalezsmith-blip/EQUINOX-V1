# Equinox-Books | Plataforma Contable Multi-Empresa NIC & SENIAT

Solución contable corporativa multi-empresa configurada para despliegue **multi-plataforma** en **Vercel** (Web Desktop Windows/macOS/Linux, Android PWA/APK TWA y iOS/iPadOS Safari PWA) con soporte **Offline-First** (IndexedDB + Workbox Service Worker + sincronización automática) y gobierno multi-tenant en **Firebase Firestore & Auth**.

## Arquitectura Multi-Plataforma Configurada

- **Frontend React + Vite + Tailwind CSS (`dist/`)**: Interfaz adaptable móvil/tablet/escritorio con soporte de áreas seguras (`viewport-fit=cover`) y precisión monetaria entera (`Cero Float`).
- **PWA Multi-Plataforma (`vite-plugin-pwa`)**:
  - Manifest completo (`EquinoxBooks`), iconos `192x192`, `512x512`, `maskable 512x512` y `apple-touch-icon.png` para iOS.
  - Precaché automático de activos estáticos y fuentes para operar sin conexión.
  - Botón de instalación integrado (`Instalar App` en Chrome/Edge/Android e instrucciones guiadas en iOS Safari).
- **Vercel Serverless Functions (`/api/*.ts`)**:
  - `GET /api/health`: Verificación real de conectividad para el motor de auto-sincronización offline.
  - `GET /api/workspace` y `POST /api/sync`: Reconciliación idempotente de mutaciones offline.
  - `POST /api/fiscal-calendar`: Consulta en tiempo real del calendario SENIAT Venezuela por terminal de RIF usando Gemini API + Google Search Grounding (manteniendo `GEMINI_API_KEY` estrictamente en el servidor).
- **Firebase Auth & Cloud Firestore**:
  - Autenticación Google por entidad y aislamiento estricto por usuario (`role: 'user'`).
  - Super Usuario y Administrador Global exclusivo: `empresalhadiqainvest@gmail.com` (`role: 'superadmin'`).

---

## Cómo conectar con tu repositorio de GitHub y desplegar en Vercel

### 1. Publicar este repositorio en GitHub (`zambranogonzalezsmith@gmail.com`)
Opción A — **Desde Google AI Studio**:
- Haz clic en **Export to GitHub** / **Save to GitHub** en la barra superior para crear el repositorio directamente en la cuenta vinculada a `zambranogonzalezsmith@gmail.com`.

Opción B — **Desde terminal con GitHub CLI o Git**:
```bash
# 1. Crear repositorio en tu cuenta GitHub (si usas gh CLI autenticado con tu cuenta)
gh repo create equinox-books --private --source=. --remote=origin --push

# O si creaste el repositorio manualmente en github.com:
git remote add origin https://github.com/<TU_USUARIO_GITHUB>/equinox-books.git
git branch -M main
git push -u origin main
```

### 2. Importar y desplegar en Vercel (`vercel.com`)
1. Inicia sesión en [vercel.com](https://vercel.com) con tu cuenta vinculada a GitHub.
2. Haz clic en **Add New → Project** y selecciona el repositorio `equinox-books`.
3. Vercel detectará automáticamente `vercel.json` (`framework: vite`, `buildCommand: npm run build`, `outputDirectory: dist`, y las funciones serverless `/api/*`).
4. En **Environment Variables** (opcional, para el Calendario Fiscal SENIAT con Google Search), agrega:
   - `GEMINI_API_KEY`: Tu clave de Gemini API (nunca con prefijo `VITE_`).
5. Haz clic en **Deploy**.

### 3. Autorizar el dominio de Vercel en Firebase Authentication (Paso Obligatorio)
Para que el inicio de sesión con Google (`signInWithPopup`) funcione en tu URL pública de Vercel (`https://tu-proyecto.vercel.app`):
1. Abre **Firebase Console** → Proyecto **`xerotic-glow-crrhs`** → **Authentication** → **Settings** → **Authorized domains**.
2. Haz clic en **Add domain** y agrega tu dominio de Vercel (por ejemplo `tu-proyecto.vercel.app` o tu dominio personalizado).
