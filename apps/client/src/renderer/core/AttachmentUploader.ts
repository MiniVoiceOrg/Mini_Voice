import { AttachmentMeta, ChatUploadTokenPayload, MessageType } from '@monky/shared';
import { networkClient } from './NetworkClient';

export interface UploadHandle {
  /** Resolves with the finalized attachment metadata once stored on the host. */
  promise: Promise<AttachmentMeta>;
  /** Aborts an in-flight upload (best effort). */
  cancel: () => void;
}

/**
 * Uploads a single file to the connected host (#11):
 *   1. request a short-lived upload token over the WebSocket
 *   2. stream the bytes to POST /attachments?token=...&name=...
 *   3. resolve with the AttachmentMeta returned by the host
 *
 * The token is bound to {userId, channelId} and consumed once, so one token is
 * requested per file. Upload progress (0..1) is reported via onProgress.
 */
export function uploadAttachment(
  channelId: string,
  file: File,
  onProgress?: (fraction: number) => void
): UploadHandle {
  let xhr: XMLHttpRequest | null = null;
  let cancelled = false;

  const promise = (async (): Promise<AttachmentMeta> => {
    const token = await requestUploadToken(channelId);
    if (cancelled) throw new Error('Upload cancelado');

    const base = networkClient.getHttpBaseUrl();
    if (!base) throw new Error('Sem conexão com o servidor');

    const url = `${base}/attachments?token=${encodeURIComponent(token)}&name=${encodeURIComponent(file.name)}`;

    return await new Promise<AttachmentMeta>((resolve, reject) => {
      const request = new XMLHttpRequest();
      xhr = request;
      request.open('POST', url);
      request.responseType = 'json';
      // Server ignores the declared type (classifies by magic bytes); octet-stream
      // keeps the request simple and predictable across platforms.
      request.setRequestHeader('Content-Type', 'application/octet-stream');

      request.upload.onprogress = (e) => {
        if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
      };

      request.onload = () => {
        const body = request.response;
        if (request.status === 200 && body && body.id) {
          onProgress?.(1);
          resolve(body as AttachmentMeta);
        } else {
          reject(new Error(mapUploadError(request.status, body)));
        }
      };
      request.onerror = () => reject(new Error('Falha de rede ao enviar o arquivo'));
      request.onabort = () => reject(new Error('Upload cancelado'));

      request.send(file);
    });
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      try {
        xhr?.abort();
      } catch {
        /* ignore */
      }
    },
  };
}

async function requestUploadToken(channelId: string): Promise<string> {
  const reply = await networkClient.sendRequest<ChatUploadTokenPayload>(
    MessageType.CHAT_REQUEST_UPLOAD_TOKEN,
    { channelId }
  );
  if (!reply?.token) throw new Error('Não foi possível obter autorização de upload');
  return reply.token;
}

function mapUploadError(status: number, body: unknown): string {
  const b = body as { error?: string; message?: string } | null;
  if (b?.message) return b.message;
  switch (status) {
    case 413:
      return 'Arquivo maior que o limite permitido pelo servidor';
    case 507:
      return 'Armazenamento do servidor cheio';
    case 401:
      return 'Autorização de upload expirada, tente novamente';
    default:
      return 'Falha ao enviar o arquivo';
  }
}
