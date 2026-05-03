import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, "../public");

const svgBuffer = readFileSync(resolve(publicDir, "og-image.svg"));
await sharp(svgBuffer).resize(1200, 630).png().toFile(resolve(publicDir, "og-image.png"));

console.log("og-image.png generated (1200x630)");
