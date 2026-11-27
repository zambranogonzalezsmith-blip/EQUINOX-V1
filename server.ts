import 'dotenv/config';
import { GoogleGenAI, Type } from '@google/genai';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import type { PendingSyncMutation } from './src/types/accounting.ts';
import {
  authenticateFirebaseRequest,
  resolveFirebaseProjectId,
  resolveFirestoreDatabaseId,
} from './api/_lib/firebaseAuth.ts';
import { createFirestoreRestAdapter, FirestoreRestError } from './api/_lib/firestoreRest.ts';
import {
  handleAuthorizedSyncPost,
  handleAuthorizedWorkspaceGet,
} from './api/_lib/workspaceService.ts';
import {
  buildRobotsTxt,
  buildSitemapXml,
  resolveSiteOrigin,
} from './src/utils/webPublishConfig.ts';

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

interface FiscalDeadlineItem {
  id: string;
  obligacion: string;
  categoria: 'IVA' | 'RET_IVA' | 'ISLR' | 'IGTF' | 'OTRO';
  fechaLimite: string;
  frecuencia: 'Quincenal' | 'Mensual' | 'Anual';
  aplica: boolean;
  detalle: string;
  norma: string;
}

interface GroundingSource {
  title: string;
  uri: string;
}

interface CachedFiscalCalendarResponse {
  cachedAt: string;
  expiresAt: number;
  payload: {
    ok: true;
    rifTerminal: string;
    tipoContribuyente: string;
    periodo: string;
    resumenNormativo: string;
    providenciaReferencia: string;
    deadlines: FiscalDeadlineItem[];
    sources: GroundingSource[];
    searchQueries: string[];
    fetchedAt: string;
    fromCache: boolean;
  };
}

const fiscalCalendarCache = new Map<string, CachedFiscalCalendarResponse>();
const FISCAL_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 horas

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  app.use(express.json({ limit: '15mb' }));

  const publicRoot = process.env.NODE_ENV === 'production'
    ? path.resolve(process.cwd(), 'dist')
    : path.resolve(process.cwd(), 'public');

  app.get('/privacidad', (_req, res) => {
    res.sendFile(path.join(publicRoot, 'privacidad.html'));
  });
  app.get('/terminos', (_req, res) => {
    res.sendFile(path.join(publicRoot, 'terminos.html'));
  });
  app.get('/aviso-legal', (_req, res) => {
    res.sendFile(path.join(publicRoot, 'aviso-legal.html'));
  });

  app.get('/robots.txt', (req, res) => {
    const reqOrigin = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.get('host')}`;
    const origin = resolveSiteOrigin(process.env) || reqOrigin;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buildRobotsTxt(origin, '/'));
  });

  app.get('/sitemap.xml', (req, res) => {
    const reqOrigin = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.get('host')}`;
    const origin = resolveSiteOrigin(process.env) || reqOrigin;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buildSitemapXml(origin, '/'));
  });

  // Health endpoint for real connectivity, observability & offline auto-sync probe
  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      serverTime: new Date().toISOString(),
      runtime: 'express-node',
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      firebaseConfigured: Boolean(resolveFirebaseProjectId()),
      geminiConfigured: Boolean(ai),
      databaseId: resolveFirestoreDatabaseId(),
    });
  });

  // Retrieve authorized multi-company workspace from Cloud Firestore
  app.get('/api/workspace', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let caller;
    try {
      caller = await authenticateFirebaseRequest(req.headers.authorization);
    } catch (err) {
      res.status(401).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Autenticación requerida.',
      });
      return;
    }

    try {
      const adapter = createFirestoreRestAdapter(caller.idToken);
      const result = await handleAuthorizedWorkspaceGet(
        caller,
        adapter,
        typeof req.query?.scope === 'string' ? req.query.scope : undefined
      );
      res.status(result.status).json(result.body);
    } catch (err) {
      if (err instanceof FirestoreRestError) {
        res.status(err.status).json({ ok: false, error: err.message, code: err.code });
        return;
      }
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Error al consultar Firestore.',
      });
    }
  });

  // Authorized & validated batch synchronization endpoint backed by Cloud Firestore
  app.post('/api/sync', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let caller;
    try {
      caller = await authenticateFirebaseRequest(req.headers.authorization);
    } catch (err) {
      res.status(401).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Autenticación requerida.',
      });
      return;
    }

    try {
      const body = (req.body || {}) as {
        mutations?: PendingSyncMutation[];
        activeCompanyId?: string;
      };
      const adapter = createFirestoreRestAdapter(caller.idToken);
      const result = await handleAuthorizedSyncPost(caller, adapter, body);
      res.status(result.status).json(result.body);
    } catch (err) {
      if (err instanceof FirestoreRestError) {
        res.status(err.status).json({
          ok: false,
          error: err.message,
          code: err.code,
        });
        return;
      }
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Error interno de sincronización',
      });
    }
  });

  // SENIAT Fiscal Calendar grounded via Google Search (@google/genai)
  app.post('/api/fiscal-calendar', async (req, res) => {
    try {
      const body = (req.body || {}) as {
        rif?: string;
        rifTerminal?: string;
        tipoContribuyente?: string;
        agenteRetencionIva?: number;
        agenteRetencionIslr?: boolean;
        sujetoIgtf?: boolean;
        periodo?: string;
        forceRefresh?: boolean;
      };

      const rif = String(body.rif || '').trim().toUpperCase();
      const digitMatch = String(body.rifTerminal || rif).match(/(\d)$/);
      const rifTerminal = digitMatch ? digitMatch[1] : '0';
      const tipoContribuyente =
        body.tipoContribuyente === 'Especial' || body.tipoContribuyente === 'Formal'
          ? body.tipoContribuyente
          : 'Ordinario';
      const agenteRetencionIva = Number(body.agenteRetencionIva || 0);
      const agenteRetencionIslr = Boolean(body.agenteRetencionIslr);
      const sujetoIgtf = Boolean(body.sujetoIgtf);
      const nowIso = new Date().toISOString();
      const periodo =
        typeof body.periodo === 'string' && /^\d{4}-\d{2}$/.test(body.periodo)
          ? body.periodo
          : nowIso.slice(0, 7);
      const [yearStr, monthStr] = periodo.split('-');

      const cacheKey = [
        rifTerminal,
        tipoContribuyente,
        agenteRetencionIva,
        agenteRetencionIslr ? 1 : 0,
        sujetoIgtf ? 1 : 0,
        periodo,
      ].join('|');

      if (!body.forceRefresh) {
        const cached = fiscalCalendarCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          res.json({
            ...cached.payload,
            fromCache: true,
          });
          return;
        }
      }

      if (!ai) {
        res.status(503).json({
          ok: false,
          error:
            'GEMINI_API_KEY no está configurada en el servidor. Configúrela en el panel Settings > Secrets para consultar el calendario SENIAT con Google Search.',
        });
        return;
      }

      const prompt = [
        `Consulta mediante Google Search el calendario oficial vigente del SENIAT en Venezuela para el año ${yearStr} y específicamente el mes ${monthStr}/${yearStr} (y vencimientos próximos inmediatos).`,
        `Datos de la empresa contribuyente:`,
        `- RIF: ${rif || `Terminal ${rifTerminal}`} (Dígito terminal RIF: ${rifTerminal})`,
        `- Tipo de Contribuyente: ${tipoContribuyente}`,
        `- Agente de Retención IVA: ${agenteRetencionIva > 0 ? `${agenteRetencionIva}%` : 'No'}`,
        `- Agente de Retención ISLR (Decreto 1.808): ${agenteRetencionIslr ? 'Sí' : 'No'}`,
        `- Sujeto IGTF 3%: ${sujetoIgtf ? 'Sí' : 'No'}`,
        `- Fecha actual de referencia: ${nowIso.slice(0, 10)}`,
        ``,
        `Devuelve las fechas límite exactas de declaración y pago del SENIAT aplicables al terminal de RIF "${rifTerminal}" para el período ${periodo} (y próximas quincenas/mes siguiente si corresponde al período de pago de ese mes fiscal), incluyendo:`,
        `1. IVA (Forma 30) — para Sujetos Pasivos Especiales según calendario quincenal del terminal ${rifTerminal}, o primeros 15 días continuos/hábiles del mes siguiente para Ordinarios.`,
        `2. Retenciones de IVA (Planilla 99035 / Quincenal SPE) para terminal ${rifTerminal}.`,
        `3. IGTF 3% (Impuesto a las Grandes Transacciones Financieras) quincenal para terminal ${rifTerminal}.`,
        `4. Anticipo de ISLR (Sujetos Pasivos Especiales, quincenal si aplica).`,
        `5. Retenciones de ISLR Mensual (XML Decreto 1.808, primeros 10 días continuos/hábiles del mes siguiente).`,
        `6. Declaración Definitiva ISLR (Forma DPJ-99026) o estimada según corresponda al ejercicio.`,
        ``,
        `Todas las fechas límite deben estar en formato YYYY-MM-DD. Indica en "aplica": true/false según la condición tributaria de la empresa.`,
      ].join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction:
            'Eres un auditor tributario venezolano especialista en normativa SENIAT. Utiliza siempre Google Search para verificar el calendario oficial vigente de Sujetos Pasivos Especiales y Contribuyentes Ordinarios publicado por el SENIAT y responde estrictamente en JSON válido conforme al esquema solicitado.',
          tools: [{ googleSearch: {} }],
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              providenciaReferencia: {
                type: Type.STRING,
                description:
                  'Nombre o número de Providencia Administrativa o Gaceta Oficial del calendario SENIAT vigente encontrada.',
              },
              resumenNormativo: {
                type: Type.STRING,
                description:
                  'Resumen ejecutivo breve (máximo 3 líneas) sobre las obligaciones del período para este terminal de RIF.',
              },
              deadlines: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    obligacion: { type: Type.STRING },
                    categoria: {
                      type: Type.STRING,
                      description: 'IVA | RET_IVA | ISLR | IGTF | OTRO',
                    },
                    fechaLimite: {
                      type: Type.STRING,
                      description: 'Fecha en formato YYYY-MM-DD',
                    },
                    frecuencia: {
                      type: Type.STRING,
                      description: 'Quincenal | Mensual | Anual',
                    },
                    aplica: { type: Type.BOOLEAN },
                    detalle: { type: Type.STRING },
                    norma: { type: Type.STRING },
                  },
                  required: [
                    'id',
                    'obligacion',
                    'categoria',
                    'fechaLimite',
                    'frecuencia',
                    'aplica',
                    'detalle',
                    'norma',
                  ],
                },
              },
            },
            required: ['providenciaReferencia', 'resumenNormativo', 'deadlines'],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      let parsedJson: {
        providenciaReferencia?: string;
        resumenNormativo?: string;
        deadlines?: Array<Partial<FiscalDeadlineItem>>;
      };

      try {
        const cleaned = rawText
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/```$/i, '')
          .trim();
        parsedJson = JSON.parse(cleaned);
      } catch {
        res.status(502).json({
          ok: false,
          error: 'No se pudo interpretar la respuesta estructurada del calendario SENIAT.',
        });
        return;
      }

      const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
      const rawChunks = groundingMetadata?.groundingChunks || [];
      const seenUris = new Set<string>();
      const sources: GroundingSource[] = [];
      for (const ch of rawChunks) {
        const uri = ch?.web?.uri;
        if (uri && !seenUris.has(uri)) {
          seenUris.add(uri);
          sources.push({
            title: ch.web?.title || uri,
            uri,
          });
        }
      }

      const searchQueries = Array.isArray(groundingMetadata?.webSearchQueries)
        ? groundingMetadata.webSearchQueries.filter((q): q is string => typeof q === 'string')
        : [];

      const validCategories = new Set(['IVA', 'RET_IVA', 'ISLR', 'IGTF', 'OTRO']);
      const validFrecuencias = new Set(['Quincenal', 'Mensual', 'Anual']);

      const normalizedDeadlines: FiscalDeadlineItem[] = (parsedJson.deadlines || [])
        .filter((d) => d && typeof d.obligacion === 'string' && typeof d.fechaLimite === 'string')
        .map((d, idx) => ({
          id: String(d.id || `seniat-${idx + 1}`),
          obligacion: String(d.obligacion),
          categoria: validCategories.has(String(d.categoria))
            ? (String(d.categoria) as FiscalDeadlineItem['categoria'])
            : 'OTRO',
          fechaLimite: /^\d{4}-\d{2}-\d{2}/.test(String(d.fechaLimite))
            ? String(d.fechaLimite).slice(0, 10)
            : `${periodo}-15`,
          frecuencia: validFrecuencias.has(String(d.frecuencia))
            ? (String(d.frecuencia) as FiscalDeadlineItem['frecuencia'])
            : 'Mensual',
          aplica: d.aplica !== false,
          detalle: String(d.detalle || ''),
          norma: String(d.norma || 'Normativa SENIAT'),
        }))
        .sort((a, b) => a.fechaLimite.localeCompare(b.fechaLimite));

      const fetchedAt = new Date().toISOString();
      const payload = {
        ok: true as const,
        rifTerminal,
        tipoContribuyente,
        periodo,
        providenciaReferencia: String(
          parsedJson.providenciaReferencia || 'Calendario Oficial SENIAT'
        ),
        resumenNormativo: String(parsedJson.resumenNormativo || ''),
        deadlines: normalizedDeadlines,
        sources,
        searchQueries,
        fetchedAt,
        fromCache: false,
      };

      fiscalCalendarCache.set(cacheKey, {
        cachedAt: fetchedAt,
        expiresAt: Date.now() + FISCAL_CACHE_TTL_MS,
        payload,
      });

      res.json(payload);
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : 'Error consultando calendario SENIAT.';
      const isAuthErr = /API_KEY|PERMISSION_DENIED|403|400/i.test(rawMsg);
      const isQuotaErr = /RESOURCE_EXHAUSTED|429|quota/i.test(rawMsg);
      const status = isQuotaErr ? 429 : isAuthErr ? 403 : 500;
      const friendlyMsg = isQuotaErr
        ? 'Límite de cuota de Gemini API alcanzado (429). Verifica tu plan o selecciona una clave API con facturación habilitada en Settings > Secrets.'
        : isAuthErr
          ? 'Clave de Gemini API inválida o sin permisos (Settings > Secrets).'
          : rawMsg;

      res.status(status).json({
        ok: false,
        error: friendlyMsg,
      });
    }
  });

  app.use('/api/*', (_req, res) => {
    res.status(404).json({ ok: false, error: 'Endpoint API no encontrado.' });
  });

  const httpServer = http.createServer(app);

  const hmrDisabled = process.env.DISABLE_HMR === 'true';

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : { server: httpServer },
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(
      express.static(distPath, {
        setHeaders(res, filePath) {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else if (
            filePath.endsWith('index.html') ||
            filePath.endsWith('sw.js') ||
            filePath.endsWith('manifest.webmanifest')
          ) {
            res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Equinox-Books server running on http://localhost:${PORT}`);
  });
}

startServer();
