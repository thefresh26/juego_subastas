import type { Property } from "@subasta/shared";

/**
 * Catálogo de inmuebles para Fase 1 (hardcodeado; en Fase 3 se carga por seed).
 */
export const PROPERTIES: Property[] = [
  {
    id: "prop-1",
    nombre: "Penthouse Bocagrande",
    ciudad: "Cartagena",
    tipo: "Apartamento",
    matriculaInmobiliaria: "060-123456",
    areaM2: 210,
    avaluo: 2_400_000_000,
    descripcion: "Penthouse con vista al mar, 4 alcobas, terraza privada.",
  },
  {
    id: "prop-2",
    nombre: "Casa Campestre La Ceja",
    ciudad: "La Ceja",
    tipo: "Casa",
    matriculaInmobiliaria: "060-654321",
    areaM2: 480,
    avaluo: 890_000_000,
    descripcion: "Casa campestre con lote de 2.000 m2, piscina y BBQ.",
  },
  {
    id: "prop-3",
    nombre: "Oficina Torre Empresarial",
    ciudad: "Bogotá",
    tipo: "Oficina",
    matriculaInmobiliaria: "050-998877",
    areaM2: 95,
    avaluo: 620_000_000,
    descripcion: "Oficina en piso 14, zona financiera, parqueadero incluido.",
  },
];
