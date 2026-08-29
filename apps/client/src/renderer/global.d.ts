/// <reference types="vite/client" />

import { ElectronApi } from '../preload/preload';

declare global {
  interface Window {
    api: ElectronApi;
  }
}

declare module '*.mp3' {
  const src: string;
  export default src;
}

declare module 'highlight.js/lib/core' {
  import { HLJSApi } from 'highlight.js';
  const hljs: HLJSApi;
  export default hljs;
}

declare module 'highlight.js/lib/languages/*' {
  import { LanguageFn } from 'highlight.js';
  const language: LanguageFn;
  export default language;
}

export {};

