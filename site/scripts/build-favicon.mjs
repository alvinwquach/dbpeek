import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, "../public");

// Inline SVG matching the favicon used in index.html
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <text y=".9em" font-size="90" font-family="monospace">🗄</text>
</svg>`;

await sharp(Buffer.from(faviconSvg))
  .resize(32, 32)
  .png()
  .toFile(resolve(publicDir, "favicon.png"));

console.log("favicon.png generated (32x32)");
