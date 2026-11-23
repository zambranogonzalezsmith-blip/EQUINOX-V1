import { GoogleGenAI, Type } from '@google/genai';
import {
  parseRequestBody,
  type VercelRequestLike,
  type VercelResponseLike,
} from './_lib/serverlessStore.ts';

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
const FISCAL_CACHE_TTL_MS = 1000 * 60 * 60 * 6;

export default async function handler(
  req: VercelRequestLike,
  res: VercelResponseLike
): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  try {
    const body =
      parseRequestBody<{
        rif?: string;
        rifTerminal?: string;
        tipoContribuyente?: string;
        agenteRetencionIva?: number;
        agenteRetencionIslr?: boolean;
        sujetoIgtf?: boolean;
        periodo?: string;
        forceRefresh?: boolean;
      }>(req.body) || {};

    const rif = String(body.rif || '').trim().toUpperCase().slice(0, 32);
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
        res.status(200).json({
          ...cached.payload,
          fromCache: true,
        });
        return;
      }
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(503).json({
        ok: false,
        error:
          'GEMINI_API_KEY no está configurada en Vercel Environment Variables. Agrégala en Settings > Environment Variables para consultar el calendario SENIAT con Google Search.',
      });
      return;
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

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

    res.status(200).json(payload);
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : 'Error consultando calendario SENIAT.';
    const isAuthErr = /API_KEY|PERMISSION_DENIED|403|400/i.test(rawMsg);
    const isQuotaErr = /RESOURCE_EXHAUSTED|429|quota/i.test(rawMsg);
    const status = isQuotaErr ? 429 : isAuthErr ? 403 : 500;
    const friendlyMsg = isQuotaErr
      ? 'Límite de cuota de Gemini API alcanzado (429). Verifica tu plan o clave API.'
      : isAuthErr
        ? 'Clave GEMINI_API_KEY inválida o sin permisos en Vercel.'
        : rawMsg;

    res.status(status).json({
      ok: false,
      error: friendlyMsg,
    });
  }
}
