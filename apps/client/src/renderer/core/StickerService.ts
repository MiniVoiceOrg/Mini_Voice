import { StickerEntry } from '@monky/shared';
import { settingsStore } from '../stores/settingsStore';

/**
 * Custom chat stickers (#356).
 *
 * Mirrors SoundboardService: the user points at a folder on their machine and we
 * list the image files in it. Only metadata is kept in memory — the bytes of a
 * sticker are read on demand and kept in a small LRU cache, so scrolling through
 * a folder with hundreds of animated GIFs does not balloon the renderer's
 * memory.
 */

/**
 * How many sticker images stay decoded in memory. The main process allows up to
 * 500 files of 2 MB each and base64 adds ~33% on top, so an unbounded cache
 * could retain over a gigabyte after a single scroll through a large folder.
 * Re-reading an evicted entry is a local file read, which is cheap.
 */
const MAX_CACHED_STICKERS = 60;

class StickerService {
  private stickers: StickerEntry[] = [];
  private dataUrls = new Map<string, string>();
  private loadedFolder: string | null = null;

  public getStickers(): StickerEntry[] {
    return this.stickers;
  }

  public hasFolder(): boolean {
    return Boolean(settingsStore.stickersFolderPath);
  }

  /** Reads the folder listing, reusing the previous result for the same folder. */
  public async loadStickers(force = false): Promise<StickerEntry[]> {
    const folder = settingsStore.stickersFolderPath;
    if (!folder) {
      this.reset();
      return [];
    }
    if (!force && this.loadedFolder === folder) return this.stickers;

    try {
      this.stickers = (await window.api?.listStickers?.(folder)) ?? [];
    } catch (e) {
      console.warn('Failed to list stickers:', e);
      this.stickers = [];
    }
    // Cached bytes belong to the previous folder, so they must not survive it.
    if (this.loadedFolder !== folder) this.dataUrls.clear();
    this.loadedFolder = folder;
    return this.stickers;
  }

  /** Returns the sticker image as a data URL, reading it from disk once. */
  public async getDataUrl(filePath: string): Promise<string | null> {
    const cached = this.dataUrls.get(filePath);
    if (cached) {
      // Re-inserting moves the entry to the end of the Map's insertion order,
      // which is what makes the eviction below least-recently-used.
      this.dataUrls.delete(filePath);
      this.dataUrls.set(filePath, cached);
      return cached;
    }
    try {
      const data = await window.api?.readSticker?.(filePath);
      if (!data) return null;
      this.dataUrls.set(filePath, data.dataUrl);
      this.evictOldest();
      return data.dataUrl;
    } catch (e) {
      console.warn('Failed to read sticker:', e);
      return null;
    }
  }

  private evictOldest(): void {
    while (this.dataUrls.size > MAX_CACHED_STICKERS) {
      const oldest = this.dataUrls.keys().next();
      if (oldest.done) return;
      this.dataUrls.delete(oldest.value);
    }
  }

  /** Materializes a sticker as a File so it can go through the upload pipeline. */
  public async toFile(sticker: StickerEntry): Promise<File | null> {
    const dataUrl = await this.getDataUrl(sticker.filePath);
    if (!dataUrl) return null;

    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    return new File([bytes], sticker.fileName, { type: sticker.mimeType });
  }

  public reset(): void {
    this.stickers = [];
    this.dataUrls.clear();
    this.loadedFolder = null;
  }
}

export const stickerService = new StickerService();
