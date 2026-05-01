/**
 * chart/chartExport.ts — PNG export for the chart panel.
 *
 * WHAT:
 *   Serializes the chart's SVG element to a PNG data URL and triggers a browser
 *   download. No extra dependencies — uses XMLSerializer + a <canvas> element.
 *
 * WHY SVG → canvas instead of html2canvas:
 *   html2canvas reimplements the browser's layout engine and weighs ~500 kB.
 *   The SVG serialization path is zero-dependency and sufficient for any
 *   SVG-backed chart library. External @font-face fonts are not embedded, but
 *   dbpeek uses the system monospace stack so the export is identical to screen.
 *
 * WHY inject a background rect:
 *   SVGs are transparent by default. Without a filled rect the PNG shows
 *   transparent pixels, which look broken in tools that composite on white
 *   (Notion, Slack, etc.). We fill with the app's deep background (#0a0a0f).
 */

// ===== EXPORT FUNCTION =====

/**
 * exportChartAsPng — finds the first <svg> inside wrapperRef, clones it with
 * an opaque background rect, rasterizes via <canvas>, and downloads as PNG.
 *
 * Steps:
 *   1. Query the live <svg> for its rendered dimensions.
 *   2. Deep-clone the SVG and inject a background <rect>.
 *   3. Serialize → Blob URL → draw onto an off-screen <canvas>.
 *   4. Scale the canvas by devicePixelRatio for HiDPI sharpness.
 *   5. Call canvas.toDataURL("image/png") and trigger <a download>.
 *
 * @param wrapperRef - React ref pointing to the div wrapping <ResponsiveContainer>
 * @param filename   - Download filename without extension
 */
export async function exportChartAsPng(
  wrapperRef: React.RefObject<HTMLDivElement | null>,
  filename: string
): Promise<void> {
  const wrapper = wrapperRef.current;
  if (!wrapper) return;

  const svgEl = wrapper.querySelector("svg");
  if (!svgEl) return;

  const { width, height } = svgEl.getBoundingClientRect();
  if (width === 0 || height === 0) return;

  // Clone so mutations don't touch the live DOM.
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  // Opaque background so the PNG is self-contained on any background colour.
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", "#0a0a0f");
  clone.insertBefore(bg, clone.firstChild);

  const svgString = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  return new Promise((resolve) => {
    const img = new Image();

    img.onload = () => {
      const dpr = window.devicePixelRatio ?? 1;
      const canvas = document.createElement("canvas");
      canvas.width = width * dpr;
      canvas.height = height * dpr;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(svgUrl);
        resolve();
        return;
      }

      ctx.scale(dpr, dpr);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(svgUrl);

      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `${filename}.png`;
      a.click();
      resolve();
    };

    img.onerror = () => {
      URL.revokeObjectURL(svgUrl);
      resolve();
    };

    img.src = svgUrl;
  });
}
