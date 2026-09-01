/**
 * Marca gráfica de Activos por Colombia: las tres barras (amarilla, azul,
 * roja) tomadas del logo del sistema comercial, para que Subasta Activa se
 * vea de la misma familia visual que las demás herramientas internas.
 */
export default function BrandMark({ className = "w-10 h-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect x="0" y="0" width="64" height="64" fill="#0D1F3C" rx="8" />
      <g transform="translate(8, 12)">
        <polygon points="0,0 40,0 36,10 -4,10" fill="#F5A800" />
        <rect x="12" y="2" width="3" height="3" fill="white" />
        <rect x="16" y="2" width="3" height="3" fill="white" />
        <rect x="12" y="6" width="3" height="3" fill="white" />
        <rect x="16" y="6" width="3" height="3" fill="white" />
        <rect x="20" y="6" width="3" height="3" fill="white" />
        <polygon points="0,15 40,15 36,25 -4,25" fill="#1A5BBF" />
        <polygon points="0,30 40,30 36,40 -4,40" fill="#E03535" />
      </g>
    </svg>
  );
}
