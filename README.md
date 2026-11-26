# Equinox-Books | Plataforma Contable Multi-Empresa NIC & SENIAT

Solución contable corporativa multi-empresa configurada para despliegue **multi-plataforma** en **Vercel** (Web Desktop Windows/macOS/Linux, Android PWA/APK TWA y iOS/iPadOS Safari PWA) con soporte **Offline-First** (IndexedDB + Workbox Service Worker + sincronización automática) y gobierno multi-tenant en **Firebase Firestore & Auth**.

## Arquitectura Configurada para GitHub + Vercel

- **Frontend React + Vite + Tailwind CSS (`dist/`)**: Interfaz adaptable móvil/tablet/escritorio con soporte de áreas seguras (`viewport-fit=cover`) y precisión monetaria entera (`Cero Float`).
- **PWA Multi-Plataforma (`vite-plugin-pwa`)**:
  - Manifest completo (`EquinoxBooks`), iconos `192x192`, `512x512`, `maskable 512x512` y `apple-touch-icon.png` para iOS.
  - Precaché automático de activos estáticos y cabeceras `Cache-Control` configuradas en `vercel.json`.
- **Vercel Serverless Functions (`/api/*.ts`, Node 22 / NodeNext)**:
  - `GET /api/health`: Sonda de conectividad y telemetría operativa (`uptimeSeconds`, estado Firebase/Gemini) para el motor de auto-sincronización offline.
  - `GET /api/workspace` y `POST /api/sync`: Endpoints autorizados con verificación RS256 de Firebase ID Token (`Authorization: Bearer`) y persistencia directa en Cloud Firestore (empaquetando `firebase-applet-config.json` vía `includeFiles`).
  - `POST /api/fiscal-calendar`: Consulta del calendario SENIAT Venezuela por terminal de RIF usando Gemini API + Google Search Grounding (`GEMINI_API_KEY` solo en servidor).
- **Motor Contable, Fiscal y Conciliación**:
  - **Partida Doble y Auditoría (`src/utils/accountingEngine.ts`)**: Validación estricta de asientos balanceados, detección de descuadres/huérfanas, verificación de Ecuación Patrimonial y cierres contables UTC-safe con Reserva Legal Art. 262 C.Com.
  - **Motor Fiscal SENIAT (`src/utils/fiscalCalculations.ts`)**: Forma 30 (16%, 8%, 31% suntuario, IGTF 3%), retenciones ISLR Decreto 1.808 (con sustraendo PNR), exportación TXT Ret. IVA, XML Ret. ISLR y CSV Libros Compras/Ventas.
  - **Conciliación Bancaria e Inventarios NIC 2 (`src/utils/bankReconciliation.ts`, `src/utils/inventoryEngine.ts`)**: Emparejamiento automático CSV vs. Mayor, asientos de ajuste, valuación Promedio Ponderado Móvil con mermas/incrementos y deterioro VNR.
- **CI/CD en GitHub Actions (`.github/workflows/`)**:
  - `.github/workflows/ci.yml`: Ejecuta validación TypeScript (`npm run lint` y `tsc -p api/tsconfig.json --noEmit`), auditoría de reglas Firestore (`eslint .`), pruebas unitarias (`npm test`) y build de producción (`npm run build`).
  - `.github/workflows/vercel-deploy.yml`: Despliega automáticamente a Vercel Preview (PRs) y Production (`main`) si se configuran los secrets de Vercel en GitHub, o convive limpiamente con la integración Git nativa de Vercel.
- **Firebase Auth, RBAC & Google Drive (`gen-lang-client-0084042355`)**:
  - Autenticación Google por cuenta y aislamiento estricto por usuario (`role: 'user'`), más respaldo individual en Google Drive (`drive.file`) verificado mediante firma **SHA-256** antes de restaurar (`src/utils/backupSecurity.ts`).
  - Super Usuario y Administrador Global exclusivo: `empresalhadiqainvest@gmail.com` (`role: 'superadmin'`).
- **Documentación Funcional Completa**: Consulta [`docs/DOCUMENTACION_FUNCIONAL.md`](./docs/DOCUMENTACION_FUNCIONAL.md) para el detalle técnico y normativo de los módulos contables, fiscales y operativos.

---

## Guía de Despliegue desde GitHub y Vercel

### 1. Subir el repositorio a GitHub (`zambranogonzalezsmith@gmail.com`)
Opción A — **Desde Google AI Studio**:
- Haz clic en **Export to GitHub** / **Save to GitHub** en la barra superior para crear o actualizar el repositorio directamente en tu cuenta vinculada.

Opción B — **Desde terminal con GitHub CLI o Git**:
```bash
# Con GitHub CLI (autenticado con gh auth login):
gh repo create equinox-books --private --source=. --remote=origin --push

# O vinculando un repositorio ya creado en github.com:
git init
git add .
git commit -m "Configuración inicial Equinox-Books para GitHub y Vercel"
git branch -M main
git remote add origin https://github.com/<TU_USUARIO_GITHUB>/equinox-books.git
git push -u origin main
```

### 2. Conectar y desplegar en Vercel (`vercel.com`)
#### Opción A — Integración Git nativa de Vercel (Recomendada)
1. Inicia sesión en [vercel.com](https://vercel.com) con tu cuenta conectada a GitHub.
2. Haz clic en **Add New → Project** e importa el repositorio `equinox-books`.
3. Vercel leerá automáticamente `vercel.json` (`framework: vite`, `installCommand`, `buildCommand: npm run build`, `outputDirectory: dist`, Node `22.x` y las funciones `/api/*`).
4. En **Settings → Environment Variables**, configura:
   - `GEMINI_API_KEY`: Tu clave privada de Gemini API (sin prefijo `VITE_`, necesaria para `/api/fiscal-calendar`).
   - `APP_URL`: La URL final asignada por Vercel (ej. `https://equinox-books.vercel.app`).
5. Haz clic en **Deploy**. Cada `git push` a `main` desplegará automáticamente a producción y cada Pull Request generará un Preview URL.

#### Opción B — Despliegue automatizado vía GitHub Actions (`.github/workflows/vercel-deploy.yml`)
Si prefieres que GitHub Actions ejecute el deploy precompilado hacia Vercel:
1. Vincula el proyecto localmente una sola vez con `npx vercel link` para obtener tus IDs en `.vercel/project.json` (`orgId` y `projectId`) y crea un token en **Vercel → Account Settings → Tokens**.
2. En tu repositorio de GitHub ve a **Settings → Secrets and variables → Actions** y agrega:
   - `VERCEL_TOKEN`
   - `VERCEL_ORG_ID`
   - `VERCEL_PROJECT_ID`

### 3. Pasos obligatorios post-despliegue (Firebase Auth y Google Drive OAuth)
Para que el inicio de sesión con Google y las copias de seguridad en Drive funcionen en tu dominio de Vercel (`https://tu-proyecto.vercel.app`):
1. Abre **Firebase Console** → Proyecto **`gen-lang-client-0084042355`** → **Authentication** → **Settings** → **Authorized domains**.
2. Haz clic en **Add domain** y agrega tu dominio asignado por Vercel (por ejemplo `tu-proyecto.vercel.app` o tu dominio personalizado).
3. En **Google Cloud Console** (proyecto `gen-lang-client-0084042355`) → **APIs & Services → Credentials**, verifica que tu dominio de Vercel figure en **Authorized JavaScript origins** del cliente OAuth web si usas dominio personalizado.
