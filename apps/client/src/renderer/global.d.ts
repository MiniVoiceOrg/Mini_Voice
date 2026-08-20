import { ElectronApi } from '../preload/preload';

declare global {
  interface Window {
    api: ElectronApi;
  }
}

export {};
