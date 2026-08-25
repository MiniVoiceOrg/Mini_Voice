import { ProtocolErrorCode } from '@monky/shared';
import { t, type TranslationKey } from './index';

/**
 * The server always answers with a `ProtocolErrorCode` plus a human message in
 * Portuguese. Since the server can't know the client's language (#16), the
 * client translates the code and only falls back to the server text when the
 * code is unknown — e.g. an older client talking to a newer server.
 */
const ERROR_KEYS: Record<ProtocolErrorCode, TranslationKey> = {
  [ProtocolErrorCode.AUTH_INVALID_PASSWORD]: 'protocolError.authInvalidPassword',
  [ProtocolErrorCode.NICKNAME_ALREADY_EXISTS]: 'protocolError.nicknameAlreadyExists',
  [ProtocolErrorCode.NICKNAME_INVALID]: 'protocolError.nicknameInvalid',
  [ProtocolErrorCode.CHANNEL_NOT_FOUND]: 'protocolError.channelNotFound',
  [ProtocolErrorCode.CHANNEL_FULL]: 'protocolError.channelFull',
  [ProtocolErrorCode.MESSAGE_TOO_LONG]: 'protocolError.messageTooLong',
  [ProtocolErrorCode.RATE_LIMITED]: 'protocolError.rateLimited',
  [ProtocolErrorCode.AVATAR_TOO_LARGE]: 'protocolError.avatarTooLarge',
  [ProtocolErrorCode.AVATAR_INVALID_TYPE]: 'protocolError.avatarInvalidType',
  [ProtocolErrorCode.SERVER_FULL]: 'protocolError.serverFull',
  [ProtocolErrorCode.PROTOCOL_VERSION_UNSUPPORTED]: 'protocolError.protocolVersionUnsupported',
  [ProtocolErrorCode.INTERNAL_ERROR]: 'protocolError.internalError',
  [ProtocolErrorCode.UNAUTHORIZED]: 'protocolError.unauthorized',
  [ProtocolErrorCode.PERMISSION_DENIED]: 'protocolError.permissionDenied',
  [ProtocolErrorCode.BAD_REQUEST]: 'protocolError.badRequest',
  [ProtocolErrorCode.ATTACHMENT_TOO_LARGE]: 'protocolError.attachmentTooLarge',
  [ProtocolErrorCode.ATTACHMENT_INVALID_TYPE]: 'protocolError.attachmentInvalidType',
  [ProtocolErrorCode.STORAGE_FULL]: 'protocolError.storageFull',
};

export function translateProtocolError(code: string | undefined, serverMessage?: string): string {
  const key = code ? ERROR_KEYS[code as ProtocolErrorCode] : undefined;
  if (key) return t(key);
  return serverMessage || code || t('protocolError.internalError');
}
