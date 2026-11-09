import type { CapacitorConfig } from '@capacitor/cli';

// Bundle ID is permanent once published to either store.
// Do NOT change `appId` after first store submission.
const config: CapacitorConfig = {
  appId: 'rw.bimoto.app',
  appName: 'Bimoto',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // For local dev against a remote API, override per-developer:
    //   url: 'http://10.0.2.2:3000',  // Android emulator → host's localhost
    //   cleartext: true,
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#F8F9FA',
  },
  android: {
    backgroundColor: '#F8F9FA',
    allowMixedContent: false,
  },
};

export default config;
