import { ADMIN_PERMISSIONS, DEFAULT_PERMISSIONS, Permission, hasPermission } from '@monky/shared';
import { IRoleRepository, IServerRepository } from '../../domain/repositories';

export class PermissionService {
  constructor(
    private serverRepo: IServerRepository,
    private roleRepo: IRoleRepository
  ) {}

  public async isOwner(userId: string): Promise<boolean> {
    const server = await this.serverRepo.getServer();
    return !!server && server.ownerUserId === userId;
  }

  public async getUserPermissions(userId: string): Promise<number> {
    if (await this.isOwner(userId)) {
      return ADMIN_PERMISSIONS;
    }

    const roles = await this.roleRepo.listRolesForUser(userId);
    if (roles.length === 0) {
      return DEFAULT_PERMISSIONS;
    }
    return roles.reduce((bits, role) => bits | role.permissions, 0);
  }

  public async checkPermission(userId: string, permission: Permission): Promise<boolean> {
    const permissions = await this.getUserPermissions(userId);
    return hasPermission(permissions, permission);
  }
}
