const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE_URL =
  'https://raw.githubusercontent.com/' +
  'justadudewhohacks/face-api.js/' +
  'master/weights/';

const MODELS_DIR = path.join(__dirname, '../public/models');

if (!fs.existsSync(MODELS_DIR)) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
}

const FILES = [
  'tiny_face_detector_model-weights_manifest.json',
  'tiny_face_detector_model-shard1',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model-shard1',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model-shard1',
  'face_recognition_model-shard2',
];

let downloaded = 0;
let skipped = 0;

FILES.forEach(file => {
  const dest = path.join(MODELS_DIR, file);
  if (fs.existsSync(dest)) {
    console.log(`Already exists: ${file}`);
    skipped++;
    return;
  }
  const fileStream = fs.createWriteStream(dest);
  https.get(BASE_URL + file, res => {
    if (res.statusCode === 301 || res.statusCode === 302) {
      // Follow redirect
      https.get(res.headers.location, redirectRes => {
        redirectRes.pipe(fileStream);
        redirectRes.on('end', () => {
          downloaded++;
          console.log(`Downloaded: ${file}`);
        });
      });
    } else {
      res.pipe(fileStream);
      res.on('end', () => {
        downloaded++;
        console.log(`Downloaded: ${file}`);
      });
    }
  }).on('error', err => {
    console.error(`Failed to download ${file}:`, err.message);
  });
});

console.log(`\nSkipped: ${skipped}, Downloading: ${FILES.length - skipped}`);
