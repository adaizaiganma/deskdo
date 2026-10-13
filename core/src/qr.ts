import { encode } from "uqr";

/**
 * QR code 畫成一條 SVG path（每個黑點一個 1×1 的方塊），外面留 4 格白邊（規格要求的「安靜區」）。
 * 畫面用 <svg viewBox="0 0 {size} {size}"><path d={d} /></svg>，白底黑點。
 */
export function qrPath(text: string): { size: number; d: string } {
  const { data, size } = encode(text, { ecc: "M", border: 4 });
  let d = "";
  data.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) d += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return { size, d };
}
