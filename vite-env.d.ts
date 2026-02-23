/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_HOLOBOX_URL: string;
  readonly VITE_DEFAULT_WIDGET_URL: string;
  readonly VITE_IFRAME_SANDBOX: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
