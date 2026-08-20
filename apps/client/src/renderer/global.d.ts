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

export {};
