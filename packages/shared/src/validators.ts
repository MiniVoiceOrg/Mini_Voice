import { z } from 'zod';
import { LIMITS, PROTOCOL_VERSION } from './constants.js';

export const nicknameSchema = z
  .string()
  .min(LIMITS.MIN_NICKNAME_LENGTH, `Nickname deve ter pelo menos ${LIMITS.MIN_NICKNAME_LENGTH} caracteres`)
  .max(LIMITS.MAX_NICKNAME_LENGTH, `Nickname não pode exceder ${LIMITS.MAX_NICKNAME_LENGTH} caracteres`)
  .regex(/^[a-zA-Z0-9_\-\.\s]+$/, 'Nickname contém caracteres inválidos')
  .transform((val) => val.trim());

export const messageContentSchema = z
  .string()
  .min(1, 'Mensagem não pode ser vazia')
  .max(LIMITS.MAX_MESSAGE_LENGTH, `Mensagem não pode exceder ${LIMITS.MAX_MESSAGE_LENGTH} caracteres`)
  .transform((val) => val.trim());

// Optional caption for an attachment message (#11). Unlike messageContentSchema
// it allows an empty string, because an attachments-only message carries no text.
export const attachmentCaptionSchema = z
  .string()
  .max(LIMITS.MAX_MESSAGE_LENGTH, `Mensagem não pode exceder ${LIMITS.MAX_MESSAGE_LENGTH} caracteres`)
  .transform((val) => val.trim());

export const channelNameSchema = z
  .string()
  .min(LIMITS.MIN_CHANNEL_NAME_LENGTH, `Nome do canal deve ter pelo menos ${LIMITS.MIN_CHANNEL_NAME_LENGTH} caracteres`)
  .max(LIMITS.MAX_CHANNEL_NAME_LENGTH, `Nome do canal não pode exceder ${LIMITS.MAX_CHANNEL_NAME_LENGTH} caracteres`)
  .transform((val) => val.trim());

export const portSchema = z
  .number()
  .int()
  .min(LIMITS.MIN_PORT, `Porta deve ser maior ou igual a ${LIMITS.MIN_PORT}`)
  .max(LIMITS.MAX_PORT, `Porta deve ser menor ou igual a ${LIMITS.MAX_PORT}`);

export const authConnectSchema = z.object({
  protocolVersion: z.number().refine((v) => v === PROTOCOL_VERSION, {
    message: `Versão de protocolo incompatível. Esperado: ${PROTOCOL_VERSION}`,
  }),
  publicKey: z
    .string()
    .min(64, 'Chave pública inválida')
    .max(128, 'Chave pública inválida')
    .regex(/^[a-fA-F0-9]+$/, 'Chave pública deve estar em hexadecimal'),
  nickname: nicknameSchema,
  password: z.string().optional().default(''),
});

export const authChallengeResponseSchema = z.object({
  signature: z.string().regex(/^[a-fA-F0-9]+$/, 'Assinatura inválida'),
});

export const channelCreateSchema = z.object({
  name: channelNameSchema,
  type: z.enum(['VOICE', 'TEXT']),
  maxParticipants: z.number().int().min(1).max(50).optional().default(LIMITS.MAX_PARTICIPANTS_PER_CHANNEL_DEFAULT),
});

export function isValidNickname(nickname: string): boolean {
  return nicknameSchema.safeParse(nickname).success;
}

export function isValidMessageContent(content: string): boolean {
  return messageContentSchema.safeParse(content).success;
}
