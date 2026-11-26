# Documentación Funcional y Técnica — Equinox-Books

Plataforma contable, fiscal y financiera multi-empresa diseñada para **Venezuela (VEN-NIF / NIC / NIIF y normativa SENIAT)** con arquitectura **Offline-First**, respaldo por cliente en **Google Drive**, persistencia en **Cloud Firestore**, autenticación **Firebase Auth** y despliegue automatizado en **GitHub + Vercel**.

---

## 1. Prioridad 1 — Partida Doble, Auditoría Contable y Pruebas

### 1.1 Aritmética Monetaria Cero-Float (`src/utils/monetary.ts`)
- Todos los montos contables, fiscales e inventarios se almacenan y operan internamente en **centavos enteros (`number`)** para eliminar errores de redondeo IEEE-754.
- `strToCents(input)` soporta formatos locales e internacionales (`50,000.00`, `50.000,00`, `1250,45`, `0.19` y valores negativos).
- `centsToStr(cents)` formatea siempre con separador de miles y dos decimales.

### 1.2 Motor de Partida Doble y Auditoría (`src/utils/accountingEngine.ts`)
- **`validateJournalEntryLines(lines, catalogo)`**:
  - Exige al menos 2 líneas con montos válidos (`>= 2`).
  - Valida que todas las cuentas existan en el catálogo NIC de la empresa activa.
  - Rechaza montos negativos o líneas con Débito y Crédito simultáneos (`deb > 0 && cred > 0`).
  - Exige equilibrio estricto: `totalDebitoCentavos === totalCreditoCentavos` y total mayor a cero.
- **`auditJournalIntegrity(dataset)`**:
  - Verifica asiento por asiento (excluyendo `ANULADO`) que `Débitos === Créditos`.
  - Detecta líneas huérfanas (códigos inexistentes en catálogo), líneas duales y montos negativos.
  - Comprueba la Ecuación Patrimonial completa: `Activo = Pasivo + Patrimonio + Resultado del Ejercicio`.
- Integrado en **`LibroDiarioModule.tsx`** con indicador de salud contable en vivo y exportación CSV.

---

## 2. Prioridad 2 — Seguridad, Roles (RBAC), Backups y Restauración

### 2.1 Autorización y Aislamiento Multi-Tenant
- **Frontend (`src/utils/rbac.ts`)** y **Backend (`api/_lib/firebaseAuth.ts`, `api/_lib/mutationValidator.ts`)**:
  - Verificación criptográfica **RS256** de Firebase ID Tokens contra las llaves públicas de Google en cada llamada a `GET /api/workspace` y `POST /api/sync`.
  - Aislamiento estricto por `ownerUid`: un usuario estándar (`role: 'user'`) solo accede y muta sus propias empresas.
  - El rol `superadmin` se otorga únicamente al correo verificado configurado (`empresalhadiqainvest@gmail.com`).
  - `POST /api/sync` valida lista blanca de acciones (`COMPANY_CREATE`, `COMPANY_UPDATE`, `COMPANY_DELETE`, `DATASET_UPDATE`, `SET_ACTIVE_COMPANY`), impide spoof de `ownerUid`, soporta idempotencia por ID de mutación y retorna `res.workspace` para reconciliación en React.
- **Reglas Firestore (`firestore.rules`)**:
  - Validan estructura estricta de esquemas (`Company`, `CompanyLedger`, `UserWorkspace`) incluyendo el campo opcional `conciliacionBancaria`.

### 2.2 Copias de Seguridad por Cliente en Google Drive y Verificación SHA-256 (`src/utils/backupSecurity.ts`)
- Cada empresa o cuenta se respalda directamente en el Google Drive del correo autenticado (`https://www.googleapis.com/auth/drive.file`), generando además una huella **SHA-256** (`checksumSha256`).
- **`validateDriveRestorePayload(...)`**:
  - Verifica `platform === 'Equinox-Books'`.
  - Recalcula y valida estrictamente el hash **SHA-256**; bloquea cualquier restauración si el archivo fue alterado o corrupto (`checksumValid === false`).
  - Aplica aislamiento por `ownerEmail` (salvo Super Admin verificado) y sanea perfiles y datasets (incluyendo `conciliacionBancaria`) antes de persistir en el estado local y encolar `COMPANY_UPDATE` / `DATASET_UPDATE` en el outbox offline.

---

## 3. Prioridad 3 — Cierres Contables, Reportes y Formatos SENIAT

### 3.1 Cierres Contables Seguros en UTC (`src/utils/accountingEngine.ts`, `CierresYTipoCambioModule.tsx`)
- **`getLastDayOfMonthISO(year, month)`**: Calcula el fin de mes en **UTC** para evitar desplazamientos de fecha en zonas horarias negativas (ej. Venezuela `UTC-4`).
- **`buildClosingEntry(...)`**:
  - Impide duplicar un cierre `ACTIVO` para el mismo tipo (`MENSUAL`/`ANUAL`) y período.
  - Cancela cuentas nominales (`Ingreso`, `Costo`, `Gasto`, `Egreso`) contra el resultado del ejercicio.
  - En cierres anuales con utilidad positiva, calcula automáticamente la **Reserva Legal del 5%** conforme al **Art. 262 del Código de Comercio**.
- **Libro Mayor (`LibroMayorModule.tsx`)**: Exportación directa a CSV tanto en Vista Resumida como en Vista Detallada.

### 3.2 Motor Tributario SENIAT (`src/utils/fiscalCalculations.ts`, `ImpuestosVenezuelaModule.tsx`)
- **Forma 30 IVA (`computeForma30Summary`)**:
  - Soporta alícuota **General 16%**, **Reducida 8%** y **Suntuaria / Lujo 31%**, además de operaciones **Exentas**.
  - Aplica signos fiscales automáticos para **Notas de Crédito (`-1`)** y **Notas de Débito (`+1`)**.
  - Integra **Excedente de Crédito Fiscal Anterior**, **Retenciones de IVA Sufridas (75% / 100%)** e **IGTF 3%**.
- **Retenciones ISLR Decreto 1.808 (`computeIslrRetention`)**:
  - Calcula el **Sustraendo** obligatorio para **Personas Naturales Residentes (PNR)**: `UT * 83.3334 * %`.
  - Aplica tarifa fija **34%** para no residentes/no domiciliados (`PNNR` / `PJND`).
- **Exportaciones Oficiales**:
  - **TXT Retenciones IVA** (`generateSeniatRetIvaTxt`): archivo delimitado por tabuladores compatible con el portal SENIAT.
  - **XML Retenciones ISLR** (`generateSeniatIslrXml`): formato `<RelacionRetencionesISLR>` ISO-8859-1.
  - **CSV Libros de Compras y Ventas** (`generateLibroIvaCsv`): columnas legales RLIVA Art. 75 y 76 con desglose completo por alícuota y BOM UTF-8.

---

## 4. Prioridad 4 — Conciliación Bancaria, Inventarios NIC 2 y Exportaciones

### 4.1 Conciliación Bancaria (`src/utils/bankReconciliation.ts`, `ConciliacionBancariaModule.tsx`)
- Importación CSV flexible (`fecha,referencia,descripcion,debito,credito` o `monto` con signo) y carga manual de movimientos del estado de cuenta bancario.
- **Emparejamiento Automático (`autoMatchBankMovements`)**: Cruza abonos/cargos bancarios contra movimientos del Libro Diario en la cuenta bancaria seleccionada (inversión contable Débito/Crédito, tolerancia de fecha `<= 7 días` y puntaje por referencia).
- **Cuadre Bancario (`computeBankReconciliationSummary`)**:
  - `Saldo Banco Conciliado = Saldo Estado de Cuenta + Depósitos en Tránsito - Cheques en Tránsito`
  - `Saldo Libros Ajustado = Saldo en Libros + Notas de Crédito Bancarias no reg. - Notas de Débito no reg.`
- Generación directa de **Asientos de Ajuste Contable** (comisiones, intereses, notas bancarias) y exportación CSV.

### 4.2 Inventarios NIC 2 (`src/utils/inventoryEngine.ts`, `InventarioNIC2Module.tsx`)
- **Costo Promedio Ponderado Móvil (`computeInventoryValuation`)**:
  - Procesa cronológicamente `ENTRADA`, `SALIDA` y `AJUSTE` diferenciando explícitamente dirección **`INCREMENTO`** (suma stock y costo) y **`MERMA`** (reduce stock al costo promedio vigente sin distorsionar el valor unitario).
  - Calcula deterioro por **Valor Neto Realizable (VNR)** según **NIC 2**.
- Exportación CSV de **Inventario Valorado NIC 2** y **Kardex Histórico**.

---

## 5. Prioridad 5 — Despliegue, Observabilidad y Mantenimiento

### 5.1 Endpoints Operativos (`/api/*` y `server.ts`)
- `GET /api/health`: Devuelve estado del servicio (`ok`, `serverTime`, `runtime`, `uptimeSeconds`, `nodeVersion`, `firebaseConfigured`, `geminiConfigured`, `databaseId`).
- `GET /api/workspace`: Carga empresas, libros y empresa activa del usuario autenticado desde Firestore.
- `POST /api/sync`: Sincroniza el outbox offline en Firestore de manera autorizada e idempotente.
- `POST /api/fiscal-calendar`: Consulta de vencimientos SENIAT usando Gemini API del lado servidor.

### 5.2 Observabilidad y Diagnóstico en Tiempo Real
- El módulo **`ArquitecturaYSyncModule.tsx`** incorpora verificación en vivo contra `/api/health` y descarga de reporte de diagnóstico JSON (sin exponer secretos ni tokens) para soporte operativo.

### 5.3 CI/CD en GitHub Actions y Vercel
- `.github/workflows/ci.yml`: Ejecuta `npm run lint`, `npx tsc -p api/tsconfig.json --noEmit`, `npx eslint .` (auditoría de `firestore.rules`), `npm test` y `npm run build`.
- `.github/workflows/vercel-deploy.yml`: Automatiza compilación y despliegue Preview/Production hacia Vercel cuando los secrets de Vercel están configurados.
