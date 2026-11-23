export type TipoCuenta = 'Activo' | 'Pasivo' | 'Patrimonio' | 'Ingreso' | 'Costo' | 'Gasto' | 'Egreso';
export type NaturalezaCuenta = 'Débito' | 'Crédito';
export type UbicacionEstado = 'Balance General' | 'Estado de Resultados';
export type IndicadorLibro = 'Ninguno' | 'Libro de Compras' | 'Libro de Ventas';
export type EstadoAsiento = 'ACTIVO' | 'MODIFICADO' | 'ANULADO';

export type TipoContribuyenteVE = 'Ordinario' | 'Especial' | 'Formal';
export type MonedaFuncional = 'VES' | 'USD';

export interface CompanyProfile {
  id: string;
  razonSocial: string;
  rif: string;
  tipoContribuyente: TipoContribuyenteVE;
  actividadEconomica: string;
  domicilioFiscal: string;
  telefono: string;
  monedaFuncional: MonedaFuncional;
  alicuotaIvaGeneral: number; // e.g., 16
  alicuotaIvaReducida: number; // e.g., 8
  agenteRetencionIva: 0 | 75 | 100;
  agenteRetencionIslr: boolean;
  sujetoIgtf: boolean; // 3% IGTF for foreign currency payments
  unidadTributariaBs: number; // Current UT value in Bs
  contadorNombre: string;
  cpcNumero: string;
  periodoFiscalInicio: string; // e.g. '01-01'
  ownerUid?: string;
  googleAuthUid?: string;
  googleAuthEmail?: string;
  googleVerified?: boolean;
  googleAuthenticatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CuentaNIC {
  codigo: string;
  nombre: string;
  tipo_cuenta: TipoCuenta;
  naturaleza: NaturalezaCuenta;
  ubicacion_estado: UbicacionEstado;
  indicador_libro: IndicadorLibro;
  seccion_destino: string;
  tipo_indice: number;
  // NIC / VEN-NIF extended attributes
  clasificacion_nic?: 'Corriente' | 'No Corriente' | 'Patrimonio' | 'Resultados';
  partida_monetaria?: boolean; // NIC 21 / NIC 29
  norma_nic?: string; // e.g., 'NIC 1', 'NIC 2', 'NIC 16', 'NIC 21'
}

export interface AsientoLinea {
  id: number;
  asiento_num: number;
  fecha: string;
  concepto: string;
  tercero: string;
  codigo_cuenta: string;
  debito_centavos: number;
  credito_centavos: number;
  estado: EstadoAsiento;
  exchange_rate_bs: number | null;
  mov_fecha?: string;
  mov_tercero?: string;
  mov_concepto?: string;
  modificado_en?: string;
  anulado_en?: string;
}

export interface ProductoInventario {
  codigo: string;
  nombre: string;
  unidad: string;
  stock_minimo: number;
  vnr_centavos?: number; // NIC 2 Valor Neto Realizable
  categoria_nic?: string;
}

export interface MovimientoInventario {
  id: number;
  fecha: string;
  producto: string;
  tipo: 'ENTRADA' | 'SALIDA' | 'AJUSTE';
  concepto: string;
  cantidad: number;
  costo_unitario: string;
}

export interface CierreContable {
  id: number;
  tipo: 'MENSUAL' | 'ANUAL';
  periodo: string;
  fecha: string;
  asiento_num: number;
  estado: 'ACTIVO' | 'ELIMINADO';
  reserva_legal_centavos?: number;
}

export interface DocumentoFiscalIVA {
  id: string;
  tipoLibro: 'COMPRAS' | 'VENTAS';
  fecha: string;
  rifTercero: string;
  razonSocialTercero: string;
  tipoPersona: 'PN' | 'PJ';
  numeroFactura: string;
  numeroControl: string;
  tipoTransaccion: '01-Registro' | '02-Nota Crédito' | '03-Nota Débito';
  facturaAfectada?: string;
  concepto: string;
  exentoCentavos: number;
  base16Centavos: number;
  iva16Centavos: number;
  base8Centavos: number;
  iva8Centavos: number;
  base31Centavos: number;
  iva31Centavos: number;
  porcentajeRetencionIva: 0 | 75 | 100;
  ivaRetenidoCentavos: number;
  comprobanteRetencion?: string;
  pagadoEnDivisas: boolean;
  igtfCentavos: number;
  asientoNum?: number;
}

export interface RetencionISLR {
  id: string;
  fecha: string;
  rifSujeto: string;
  razonSocial: string;
  tipoPersona: 'PNR' | 'PNNR' | 'PJD' | 'PJND';
  codigoConcepto: string;
  concepto: string;
  numeroFactura: string;
  numeroControl: string;
  montoBaseCentavos: number;
  porcentajeRetencion: number;
  sustraendoCentavos: number;
  montoRetenidoCentavos: number;
  comprobanteNumero: string;
}

export interface CompanyDataset {
  catalogo: CuentaNIC[];
  diario: AsientoLinea[];
  nextId: number;
  exchangeRates: Record<string, number>;
  cierres: CierreContable[];
  inventario: {
    productos: ProductoInventario[];
    movimientos: MovimientoInventario[];
    movSeq: number;
  };
  documentosFiscales: DocumentoFiscalIVA[];
  retencionesIslr: RetencionISLR[];
  excedenteIvaAnteriorCentavos: number;
  updatedAt: string;
}

export interface WorkspaceState {
  companies: CompanyProfile[];
  activeCompanyId: string;
  companyData: Record<string, CompanyDataset>;
  lastServerSync: string | null;
}

export interface PendingSyncMutation {
  id: string;
  timestamp: string;
  companyId: string;
  companyName: string;
  actionType: string;
  summary: string;
  datasetSnapshot?: CompanyDataset;
  companySnapshot?: CompanyProfile;
  deletedCompanyId?: string;
}

export interface SyncLogEntry {
  id: string;
  timestamp: string;
  status: 'SYNCED' | 'QUEUED_OFFLINE' | 'ERROR';
  message: string;
  itemsCount: number;
}

export type ActiveTab =
  | 'diario'
  | 'catalogo'
  | 'mayor'
  | 'estados'
  | 'fiscal'
  | 'inventario'
  | 'cierres'
  | 'empresas'
  | 'arquitectura'
  | 'licencias'
  | 'superadmin';

export type TamanoEmpresaCRM =
  | 'Micro'
  | 'Pequeña'
  | 'Mediana'
  | 'Gran Empresa'
  | 'Firma Contable';

export type NivelPrivacidadCRM = 'ESTRICTO_AISLADO' | 'AUDITORIA_CORPORATIVA';

export interface CrmEmpresaTemplate {
  ownerUid: string;
  ownerEmail: string;
  linkedCompanyId: string;
  razonSocial: string;
  nombreComercial?: string;
  rif: string;
  sectorIndustria?: string;
  tamanoEmpresa: TamanoEmpresaCRM;
  representanteNombre: string;
  representanteCargo?: string;
  telefonoCorporativo?: string;
  whatsappCorporativo?: string;
  domicilioFiscal?: string;
  ciudadEstado?: string;
  sitioWeb?: string;
  tipoContribuyente: TipoContribuyenteVE;
  monedaFuncional: MonedaFuncional;
  contadorResponsable?: string;
  cpcNumero?: string;
  nivelPrivacidad: NivelPrivacidadCRM;
  autenticacionGoogleObligatoria: boolean;
  bloquearExportacionExterna?: boolean;
  notasCrm?: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}
