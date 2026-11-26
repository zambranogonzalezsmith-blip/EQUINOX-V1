import type { MovimientoInventario, ProductoInventario } from '../types/accounting.js';
import { escapeCsvCell } from './fiscalCalculations.js';
import { centsToStr, formatDateShort, strToCents } from './monetary.js';

export interface InventoryProductStat {
  prod: ProductoInventario;
  stock: number;
  costoUnitarioCentavos: number;
  valorCostoCentavos: number;
  deterioroCentavos: number;
  valorEnLibrosNic2Centavos: number;
  bajoStock: boolean;
}

export interface InventoryValuationSummary {
  stats: InventoryProductStat[];
  valorTotalCostoCentavos: number;
  deterioroTotalCentavos: number;
  valorTotalNic2Centavos: number;
  productosBajoMinimoCount: number;
}

/**
 * Calcula existencia y Costo Promedio Ponderado Móvil (NIC 2).
 * Soporta ENTRADA, SALIDA, y AJUSTE (INCREMENTO o MERMA).
 */
export function computeInventoryValuation(
  productos: ProductoInventario[],
  movimientos: MovimientoInventario[]
): InventoryValuationSummary {
  const orderedMovs = [...(movimientos || [])].sort((a, b) => {
    const cmpDate = (a.fecha || '').localeCompare(b.fecha || '');
    return cmpDate !== 0 ? cmpDate : a.id - b.id;
  });

  const stats: InventoryProductStat[] = (productos || []).map((prod) => {
    const movs = orderedMovs.filter((m) => m.producto === prod.codigo);
    let stock = 0;
    let totalCostCentavos = 0;

    for (const m of movs) {
      const qty = Math.abs(Number(m.cantidad || 0));
      const isShrinkage =
        m.tipo === 'SALIDA' ||
        (m.tipo === 'AJUSTE' && (m.direccion === 'MERMA' || Number(m.cantidad) < 0));

      if (!isShrinkage) {
        const unitCostCentavos = strToCents(m.costo_unitario);
        const lineCost = Math.round(qty * unitCostCentavos);
        stock += qty;
        totalCostCentavos += lineCost;
      } else {
        const avgBefore = stock > 0 ? totalCostCentavos / stock : strToCents(m.costo_unitario);
        const deductedQty = Math.min(stock, qty);
        const deductedCost = Math.round(deductedQty * avgBefore);
        stock = Math.max(0, stock - qty);
        totalCostCentavos = Math.max(0, totalCostCentavos - deductedCost);
      }
    }

    const costoUnitarioCentavos = stock > 0 ? Math.round(totalCostCentavos / stock) : 0;
    const valorCostoCentavos = Math.max(0, totalCostCentavos);
    const vnrUnit = prod.vnr_centavos ?? 0;
    const deterioroUnit =
      vnrUnit > 0 && costoUnitarioCentavos > vnrUnit ? costoUnitarioCentavos - vnrUnit : 0;
    const deterioroCentavos = Math.round(deterioroUnit * stock);
    const valorEnLibrosNic2Centavos = Math.max(0, valorCostoCentavos - deterioroCentavos);

    return {
      prod,
      stock,
      costoUnitarioCentavos,
      valorCostoCentavos,
      deterioroCentavos,
      valorEnLibrosNic2Centavos,
      bajoStock: stock < prod.stock_minimo,
    };
  });

  const valorTotalCostoCentavos = stats.reduce((s, r) => s + r.valorCostoCentavos, 0);
  const deterioroTotalCentavos = stats.reduce((s, r) => s + r.deterioroCentavos, 0);
  const valorTotalNic2Centavos = stats.reduce((s, r) => s + r.valorEnLibrosNic2Centavos, 0);
  const productosBajoMinimoCount = stats.filter((r) => r.bajoStock).length;

  return {
    stats,
    valorTotalCostoCentavos,
    deterioroTotalCentavos,
    valorTotalNic2Centavos,
    productosBajoMinimoCount,
  };
}

export function generateInventoryValuationCsv(
  summary: InventoryValuationSummary,
  companyName: string
): string {
  const header = [
    'Código',
    'Artículo',
    'Categoría NIC',
    'Unidad',
    'Stock Actual',
    'Stock Mínimo',
    'Costo Promedio Unit.',
    'Valor Costo Total',
    'VNR Unitario',
    'Deterioro NIC 2',
    'Valor en Libros NIC 2',
  ];

  const rows = summary.stats.map((s) =>
    [
      s.prod.codigo,
      s.prod.nombre,
      s.prod.categoria_nic || 'Mercancías',
      s.prod.unidad,
      s.stock,
      s.prod.stock_minimo,
      centsToStr(s.costoUnitarioCentavos),
      centsToStr(s.valorCostoCentavos),
      s.prod.vnr_centavos ? centsToStr(s.prod.vnr_centavos) : 'N/A',
      centsToStr(s.deterioroCentavos),
      centsToStr(s.valorEnLibrosNic2Centavos),
    ]
      .map(escapeCsvCell)
      .join(',')
  );

  return (
    '\uFEFF' +
    [
      `${escapeCsvCell(companyName)},${escapeCsvCell('INVENTARIO VALORADO NIC 2 (PROMEDIO PONDERADO MÓVIL)')}`,
      header.map(escapeCsvCell).join(','),
      ...rows,
    ].join('\n')
  );
}

export function generateInventoryKardexCsv(
  movimientos: MovimientoInventario[],
  productos: ProductoInventario[],
  companyName: string
): string {
  const prodMap = new Map(productos.map((p) => [p.codigo, p.nombre]));
  const header = ['Fecha', 'Código', 'Producto', 'Tipo', 'Dirección', 'Concepto', 'Cantidad', 'Costo Unitario'];
  const ordered = [...(movimientos || [])].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const rows = ordered.map((m) =>
    [
      formatDateShort(m.fecha),
      m.producto,
      prodMap.get(m.producto) || m.producto,
      m.tipo,
      m.direccion || (m.tipo === 'SALIDA' ? 'SALIDA' : 'ENTRADA'),
      m.concepto,
      m.cantidad,
      m.costo_unitario,
    ]
      .map(escapeCsvCell)
      .join(',')
  );

  return (
    '\uFEFF' +
    [
      `${escapeCsvCell(companyName)},${escapeCsvCell('KARDEX HISTÓRICO DE INVENTARIO')}`,
      header.map(escapeCsvCell).join(','),
      ...rows,
    ].join('\n')
  );
}
