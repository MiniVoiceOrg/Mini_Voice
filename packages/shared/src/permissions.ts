export enum Permission {
  MANAGE_CHANNELS = 1 << 0,
  MANAGE_SERVER = 1 << 1,
  MANAGE_ROLES = 1 << 2,
  KICK_MEMBERS = 1 << 3,
  SPEAK = 1 << 4,
  MUTE_MEMBERS = 1 << 5,
  DEAFEN_MEMBERS = 1 << 6,
  MOVE_MEMBERS = 1 << 7,
  SEND_MESSAGES = 1 << 8,
  READ_MESSAGES = 1 << 9,
  ATTACH_FILES = 1 << 10,
  ADMINISTRATOR = 1 << 11,
}

export const DEFAULT_PERMISSIONS =
  Permission.SPEAK |
  Permission.SEND_MESSAGES |
  Permission.READ_MESSAGES |
  Permission.ATTACH_FILES;

export const ADMIN_PERMISSIONS = 0xFFFFFFFF;

export function hasPermission(userPermissions: number, permission: Permission): boolean {
  if (userPermissions & Permission.ADMINISTRATOR) return true;
  return (userPermissions & permission) !== 0;
}

/**
 * ADMINISTRATOR is no longer granted through a custom role: admin rights come
 * exclusively from the Admin role, given by promoting the member (#277).
 */
export function stripAdministrator(permissions: number): number {
  return (permissions & ~Permission.ADMINISTRATOR) >>> 0;
}
