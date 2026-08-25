import { v4 as uuidv4 } from 'uuid';
import { Permission, ProtocolErrorCode, Role, RoleAssignPayload, RoleCreatePayload, RoleUpdatePayload, UserRoleSummary, roleAssignmentSchema, roleCreateSchema, roleUpdateSchema } from '@monky/shared';
import { RoleRecord } from '../../domain/entities';
import { IRoleRepository, IUserRepository } from '../../domain/repositories';
import { PermissionService } from './PermissionService';

interface RoleResult {
  success: boolean;
  errorCode?: ProtocolErrorCode;
  errorMessage?: string;
  role?: Role;
}

interface RoleStateResult {
  roles: Role[];
  userRoles: UserRoleSummary[];
}

export class RoleService {
  constructor(
    private roleRepo: IRoleRepository,
    private userRepo: IUserRepository,
    private permissionService: PermissionService
  ) {}

  private toRole(role: RoleRecord): Role {
    return {
      id: role.id,
      name: role.name,
      color: role.color,
      position: role.position,
      permissions: role.permissions,
      isDefault: role.isDefault,
    };
  }

  public async listRoles(): Promise<Role[]> {
    return (await this.roleRepo.listAll()).map((role) => this.toRole(role));
  }

  public async listUserRoles(): Promise<UserRoleSummary[]> {
    const rows = await this.roleRepo.listUserRoles();
    const grouped = new Map<string, string[]>();
    for (const row of rows) {
      const current = grouped.get(row.userId) ?? [];
      current.push(row.roleId);
      grouped.set(row.userId, current);
    }
    return Array.from(grouped.entries()).map(([userId, roleIds]) => ({ userId, roleIds }));
  }

  public async getRoleState(): Promise<RoleStateResult> {
    return {
      roles: await this.listRoles(),
      userRoles: await this.listUserRoles(),
    };
  }

  public async ensureDefaultRolesAssigned(userId: string): Promise<void> {
    const defaultRoles = await this.roleRepo.getDefaultRoles();
    for (const role of defaultRoles) {
      await this.roleRepo.assignRole(userId, role.id);
    }
  }

  public async assignAdminRole(userId: string): Promise<void> {
    const adminRole = await this.roleRepo.findByName('Admin');
    if (adminRole) {
      await this.roleRepo.assignRole(userId, adminRole.id);
    }
  }

  public async createRole(actorUserId: string, payload: RoleCreatePayload): Promise<RoleResult> {
    if (!(await this.permissionService.checkPermission(actorUserId, Permission.MANAGE_ROLES))) {
      return { success: false, errorCode: ProtocolErrorCode.PERMISSION_DENIED, errorMessage: 'Você não pode gerenciar cargos.' };
    }

    const parsed = roleCreateSchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, errorCode: ProtocolErrorCode.BAD_REQUEST, errorMessage: parsed.error.errors[0]?.message || 'Cargo inválido' };
    }

    const roleRecord: RoleRecord = {
      id: uuidv4(),
      name: parsed.data.name,
      color: parsed.data.color ?? null,
      permissions: parsed.data.permissions,
      position: parsed.data.position ?? Date.now(),
      isDefault: parsed.data.isDefault ?? false,
      createdAt: Date.now(),
    };
    await this.roleRepo.create(roleRecord);
    return { success: true, role: this.toRole(roleRecord) };
  }

  public async updateRole(actorUserId: string, payload: RoleUpdatePayload): Promise<RoleResult> {
    if (!(await this.permissionService.checkPermission(actorUserId, Permission.MANAGE_ROLES))) {
      return { success: false, errorCode: ProtocolErrorCode.PERMISSION_DENIED, errorMessage: 'Você não pode gerenciar cargos.' };
    }

    const parsed = roleUpdateSchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, errorCode: ProtocolErrorCode.BAD_REQUEST, errorMessage: parsed.error.errors[0]?.message || 'Cargo inválido' };
    }

    const existing = await this.roleRepo.findById(parsed.data.roleId);
    if (!existing) {
      return { success: false, errorCode: ProtocolErrorCode.BAD_REQUEST, errorMessage: 'Cargo não encontrado.' };
    }

    const updates: Partial<RoleRecord> = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.color !== undefined) updates.color = parsed.data.color ?? null;
    if (parsed.data.permissions !== undefined) updates.permissions = parsed.data.permissions;
    if (parsed.data.position !== undefined) updates.position = parsed.data.position;
    if (parsed.data.isDefault !== undefined) updates.isDefault = parsed.data.isDefault;
    await this.roleRepo.update(existing.id, updates);
    const updated = await this.roleRepo.findById(existing.id);
    return { success: true, role: this.toRole(updated ?? { ...existing, ...updates }) };
  }

  public async deleteRole(actorUserId: string, roleId: string): Promise<{ success: boolean; errorCode?: ProtocolErrorCode; errorMessage?: string }> {
    if (!(await this.permissionService.checkPermission(actorUserId, Permission.MANAGE_ROLES))) {
      return { success: false, errorCode: ProtocolErrorCode.PERMISSION_DENIED, errorMessage: 'Você não pode gerenciar cargos.' };
    }

    const role = await this.roleRepo.findById(roleId);
    if (!role) {
      return { success: false, errorCode: ProtocolErrorCode.BAD_REQUEST, errorMessage: 'Cargo não encontrado.' };
    }

    const isProtectedRole = role.isDefault || role.name.toLowerCase() === 'admin';
    if (isProtectedRole && !(await this.permissionService.isOwner(actorUserId))) {
      return { success: false, errorCode: ProtocolErrorCode.PERMISSION_DENIED, errorMessage: 'Apenas o dono do servidor pode excluir este cargo.' };
    }

    await this.roleRepo.delete(roleId);
    return { success: true };
  }

  public async assignRole(actorUserId: string, payload: RoleAssignPayload): Promise<{ success: boolean; errorCode?: ProtocolErrorCode; errorMessage?: string }> {
    if (!(await this.permissionService.checkPermission(actorUserId, Permission.MANAGE_ROLES))) {
      return { success: false, errorCode: ProtocolErrorCode.PERMISSION_DENIED, errorMessage: 'Você não pode gerenciar cargos.' };
    }

    const parsed = roleAssignmentSchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, errorCode: ProtocolErrorCode.BAD_REQUEST, errorMessage: parsed.error.errors[0]?.message || 'Dados inválidos.' };
    }

    const user = await this.userRepo.findById(parsed.data.userId);
    const role = await this.roleRepo.findById(parsed.data.roleId);
    if (!user || !role) {
      return { success: false, errorCode: ProtocolErrorCode.BAD_REQUEST, errorMessage: 'Usuário ou cargo não encontrado.' };
    }

    await this.roleRepo.assignRole(parsed.data.userId, parsed.data.roleId);
    return { success: true };
  }

  public async unassignRole(actorUserId: string, payload: RoleAssignPayload): Promise<{ success: boolean; errorCode?: ProtocolErrorCode; errorMessage?: string }> {
    if (!(await this.permissionService.checkPermission(actorUserId, Permission.MANAGE_ROLES))) {
      return { success: false, errorCode: ProtocolErrorCode.PERMISSION_DENIED, errorMessage: 'Você não pode gerenciar cargos.' };
    }

    const parsed = roleAssignmentSchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, errorCode: ProtocolErrorCode.BAD_REQUEST, errorMessage: parsed.error.errors[0]?.message || 'Dados inválidos.' };
    }

    const role = await this.roleRepo.findById(parsed.data.roleId);
    if (!role) {
      return { success: false, errorCode: ProtocolErrorCode.BAD_REQUEST, errorMessage: 'Cargo não encontrado.' };
    }
    if (role.isDefault) {
      return { success: false, errorCode: ProtocolErrorCode.BAD_REQUEST, errorMessage: 'O cargo padrão não pode ser removido.' };
    }

    await this.roleRepo.unassignRole(parsed.data.userId, parsed.data.roleId);
    return { success: true };
  }
}
