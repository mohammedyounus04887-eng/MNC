import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const outDir = path.resolve('public');

async function generate() {
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    const baseSvg = (size, rx, fontSize, yOffset) => `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" rx="${rx}" fill="#2d9653"/>
  <text x="${size / 2}" y="${yOffset}" font-family="Arial, sans-serif" font-weight="bold" font-size="${fontSize}" fill="white" text-anchor="middle">M</text>
</svg>
`;

    await sharp(Buffer.from(baseSvg(192, 38, 112, 135)))
        .png()
        .toFile(path.join(outDir, 'pwa-192x192.png'));

    await sharp(Buffer.from(baseSvg(512, 100, 300, 360)))
        .png()
        .toFile(path.join(outDir, 'pwa-512x512.png'));

    // iOS icon usually wants no rounded corners in the image itself
    await sharp(Buffer.from(baseSvg(180, 0, 105, 125)))
        .png()
        .toFile(path.join(outDir, 'apple-touch-icon.png'));

    console.log("Icons generated successfully!");
}

generate().catch(console.error);
