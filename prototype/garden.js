// Decorative plants are deterministic SVGs, independent of note contents or AI state.
// They never imply a transcription or a sync has completed.
function flowerSVG(variant = 0, cls = "") {
  const petals = [
    "var(--petal-pink)",
    "var(--petal-yellow)",
    "var(--petal-lilac)",
  ];
  return `<svg class="flower ${cls}" viewBox="0 0 80 100" aria-hidden="true">
    <path d="M40 88Q43 66 39 38" fill="none" stroke="var(--stem)" stroke-width="3" stroke-linecap="round"/>
    <path d="M40 75Q16 74 18 59Q34 57 40 75M40 65Q62 62 62 49Q44 49 40 65" fill="var(--leaf)"/>
    <g fill="${petals[variant % 3]}" stroke="var(--flower-line)" stroke-width="1.2">
      ${Array.from({ length: 6 }, (_, i) => `<ellipse cx="40" cy="20" rx="10" ry="15" transform="rotate(${i * 60} 40 34)"/>`).join("")}
    </g><circle cx="40" cy="34" r="9" fill="var(--pollen)"/>
    <circle cx="37" cy="33" r="1.3" fill="#53492e"/><circle cx="43" cy="33" r="1.3" fill="#53492e"/>
    <path d="M37 37Q40 40 43 37" fill="none" stroke="#53492e" stroke-width="1.1" stroke-linecap="round"/>
  </svg>`;
}
function gardenSVG(cls = "") {
  return `<div class="garden-art ${cls}" aria-hidden="true">
    <svg class="garden-ground" viewBox="0 0 290 195"><ellipse cx="145" cy="177" rx="112" ry="9" fill="var(--garden-shadow)"/>
      <path d="M71 123Q140 136 214 122L198 177Q144 193 88 177Z" fill="var(--pot)" stroke="var(--pot-line)" stroke-width="2"/>
      <ellipse cx="143" cy="124" rx="72" ry="12" fill="var(--soil)" stroke="var(--pot-line)" stroke-width="2"/>
      <path d="M102 147Q142 158 184 147" fill="none" stroke="var(--pot-line)" stroke-width="1.5"/>
      <path d="M231 48l3-7m7 17 8-1M48 80l-6-4" stroke="var(--stem)" stroke-width="2" stroke-linecap="round"/>
    </svg><div class="garden-flower f1">${flowerSVG(0)}</div><div class="garden-flower f2">${flowerSVG(1)}</div><div class="garden-flower f3">${flowerSVG(2)}</div>
    <span class="garden-note">小事也有花期</span>
  </div>`;
}
function noteFlower(id) {
  return flowerSVG(
    [...String(id)].reduce((n, c) => n + c.charCodeAt(0), 0) % 3,
    "note-flower",
  );
}
