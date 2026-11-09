/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  /** 'true' arms the native push-notification flow (requires a Firebase-configured build). Default: off. */
  readonly VITE_PUSH_ENABLED?: string;
  /** Emergency press-and-hold duration in ms. Default 1000 — see config/sos.ts. */
  readonly VITE_SOS_HOLD_MS?: string;
  /** Emergency cancel-window duration in ms. Default 3000 — see config/sos.ts. */
  readonly VITE_SOS_CANCEL_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
