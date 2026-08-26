import { v4 as uuidv4 } from 'uuid';
import { RoleRecord } from '../../domain/entities';
import { ANSI, color, PERMISSION_OPTIONS } from '../constants';
import { CliContext } from '../context';
import {
  encodePermissions,
  formatBool,
  normalizeRoleColor,
  parsePermissionNames,
  permissionLabel,
} from '../formatters';
import { ask, askChoice, askMultiChoice, confirm } from '../prompts';
import { selectUser } from './members';

export async function resolveRole(ctx: CliContext, query: string): Promise<RoleRecord> {
  const normalized = query.trim();
  if (!normalized) {
    throw new Error('Informe um cargo.');
  }

  const byId = await ctx.roleRepo.findById(normalized);
  if (byId) return byId;

  const byName = await ctx.roleRepo.findByName(normalized);
  if (byName) return byName;

  throw new Error(`Cargo não encontrado: ${normalized}`);
}

export async function selectRole(
  ctx: CliContext,
  question: string,
  query?: string,
  rolesOverride?: RoleRecord[]
): Promise<RoleRecord> {
  if (query?.trim()) {
    return resolveRole(ctx, query);
  }

  const roles = rolesOverride ?? (await ctx.roleRepo.listAll());
  if (roles.length === 0) {
    throw new Error('Nenhum cargo cadastrado.');
  }

  const labels = roles.map((r) => `${r.name} (${r.id})`);
  const selected = await askChoice(question, labels);
  return roles[labels.indexOf(selected)];
}

export async function listRoles(ctx: CliContext): Promise<void> {
  const roles = await ctx.roleRepo.listAll();
  const userRoles = await ctx.roleRepo.listUserRoles();
  const counts = new Map<string, number>();

  for (const entry of userRoles) {
    counts.set(entry.roleId, (counts.get(entry.roleId) ?? 0) + 1);
  }

  if (roles.length === 0) {
    console.log(color('Nenhum cargo cadastrado.', ANSI.yellow));
    return;
  }

  for (const role of roles) {
    console.log(color(`${role.name} (${role.id})`, ANSI.bold));
    console.log(`  color: ${role.color ?? '-'}`);
    console.log(`  position: ${role.position}`);
    console.log(`  permissions: ${role.permissions}`);
    console.log(`  isDefault: ${formatBool(role.isDefault)}`);
    console.log(`  members: ${counts.get(role.id) ?? 0}`);
  }
}

export async function createRoleInteractive(ctx: CliContext, args: string[]): Promise<void> {
  const inlineName = args[0];
  const inlineColor = args[1];
  const inlinePermissions = args.slice(2).join(' ');

  const name = inlineName?.trim() || (await ask('Nome do cargo'));
  if (name.trim().length < 2) {
    throw new Error('O nome do cargo deve ter pelo menos 2 caracteres.');
  }

  const colorInput = inlineColor !== undefined ? inlineColor : await ask('Cor do cargo (#RRGGBB, opcional)');
  const roleColor = normalizeRoleColor(colorInput || '');

  const selectedPermissions = inlinePermissions.trim()
    ? parsePermissionNames(inlinePermissions)
    : await askMultiChoice(
        'Permissões do cargo:',
        PERMISSION_OPTIONS.map((entry) => `${permissionLabel(entry.name)} (${entry.name})`)
      );

  const permissions = inlinePermissions.trim()
    ? encodePermissions(selectedPermissions)
    : encodePermissions(
        selectedPermissions.map((entry) => (entry.includes('(') ? entry.slice(0, entry.indexOf(' (')) : entry))
      );

  const role: RoleRecord = {
    id: uuidv4(),
    name: name.trim(),
    color: roleColor,
    position: Date.now(),
    permissions,
    isDefault: false,
    createdAt: Date.now(),
  };

  await ctx.roleRepo.create(role);
  console.log(color(`Cargo "${role.name}" criado com sucesso.`, ANSI.green));
}

export async function assignRoleInteractive(ctx: CliContext, args: string[], unassign: boolean): Promise<void> {
  const user = await selectUser(ctx, 'Membros do servidor:', args[0]);
  const availableRoles = unassign ? await ctx.roleRepo.listRolesForUser(user.id) : await ctx.roleRepo.listAll();

  if (availableRoles.length === 0) {
    console.log(color(unassign ? 'Esse membro não possui cargos removíveis.' : 'Nenhum cargo disponível.', ANSI.yellow));
    return;
  }

  const role = await selectRole(
    ctx,
    unassign ? 'Selecione o cargo para remover:' : 'Selecione o cargo para atribuir:',
    args[1],
    availableRoles
  );

  if (unassign && role.isDefault) {
    throw new Error('O cargo padrão não pode ser removido.');
  }

  if (unassign) {
    await ctx.roleRepo.unassignRole(user.id, role.id);
    console.log(color(`Cargo ${role.name} removido de ${user.nickname}.`, ANSI.green));
    return;
  }

  await ctx.roleRepo.assignRole(user.id, role.id);
  console.log(color(`Cargo ${role.name} atribuído para ${user.nickname}.`, ANSI.green));
}

export async function deleteRoleInteractive(ctx: CliContext, args: string[]): Promise<void> {
  const role = await selectRole(ctx, 'Selecione o cargo para remover:', args[0]);
  const accepted = await confirm(`Confirma a remoção do cargo ${role.name}?`, false);
  if (!accepted) {
    console.log(color('Operação cancelada.', ANSI.yellow));
    return;
  }

  await ctx.roleRepo.delete(role.id);
  console.log(color(`Cargo ${role.name} removido com sucesso.`, ANSI.green));
}
