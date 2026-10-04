import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.magicnutrition.hub',
  appName: 'Magic Nutrition Club',
  webDir: 'dist',
  server: { url: 'https://magicnutritionclub.com', cleartext: false },
};
export default config;