

// Marca da Aura: uma argola de bola cativa (captive bead ring) — a joia mais
// reconhecível do universo do piercing. Substitui o monograma "A"/"AC", que era
// só um quadrado com letras e não dizia nada sobre o produto.
//
// Desenhada em SVG inline de propósito: escala sem perder nitidez em qualquer
// densidade de tela e herda a paleta sem precisar de arquivo de imagem.
/** @param {{ size?: number, className?: string, title?: string }} props */
export function BrandMark({ size = 36, className, title = "Aura" }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      role="img"
      aria-label={title}
      focusable="false"
    >
      <defs>
        <linearGradient id="aura-mark-gold" x1="6" y1="4" x2="34" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#E6C98C" />
          <stop offset="52%" stopColor="#C9A86A" />
          <stop offset="100%" stopColor="#A87A34" />
        </linearGradient>
        <linearGradient id="aura-mark-bead" x1="15" y1="6" x2="25" y2="16" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F2E0BC" />
          <stop offset="45%" stopColor="#D9BA85" />
          <stop offset="100%" stopColor="#A87A34" />
        </linearGradient>
      </defs>

      {/* Aro aberto no topo, onde a bola se encaixa. */}
      <path
        d="M24.1 10.7 A 12 12 0 1 1 15.9 10.7"
        stroke="url(#aura-mark-gold)"
        strokeWidth="3.2"
        strokeLinecap="round"
      />

      {/* Bola cativa. */}
      <circle cx="20" cy="10.6" r="4.7" fill="url(#aura-mark-bead)" />
      {/* Brilho que dá volume à esfera. */}
      <circle cx="18.4" cy="9" r="1.5" fill="#FFFFFF" opacity=".55" />
    </svg>
  );
}
