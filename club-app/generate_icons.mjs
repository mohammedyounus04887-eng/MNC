import fs from 'fs';
import path from 'path';

// A tiny 1x1 transparent PNG base64 string
const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const buffer = Buffer.from(base64Png, 'base64');
const publicDir = path.join(__dirname, 'public');

fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), buffer);
fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), buffer);
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), buffer);
fs.writeFileSync(path.join(publicDir, 'mask-icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#8B5CF6"/></svg>');

console.log('Created placeholder PWA icons.');
