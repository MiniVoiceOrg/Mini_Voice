import { LIMITS, MessageType, Permission, Role, ServerUpdateSettingsPayload } from '@monky/shared';
import logoUrl from '../assets/Logo.png';
import { escapeHtml } from '../utils/html';
import { getAvatarUrl } from '../utils/avatar';
import { formatBytes } from '../utils/attachment';
import { networkClient } from '../core/NetworkClient';
import { serverStore } from '../stores/serverStore';
import { t } from '../i18n';
import { settingsStore, ChatSoundMode } from '../stores/settingsStore';

export class ServerSettingsModal {
  private modalEl: HTMLElement | null = null;
  private shouldRemovePassword = false;
  private pendingIconBase64: string | null | undefined = undefined;
  private draggedRoleId: string | null = null;

  public open(): void {
    this.close();
    this.shouldRemovePassword = false;
    this.pendingIconBase64 = undefined;

    const s = serverStore.serverDetails;
    if (!s) return;

    const hasPass = !!s.hasPassword;
    const canManageServer = serverStore.hasPermission(Permission.MANAGE_SERVER);
    const canManageRoles = serverStore.hasPermission(Permission.MANAGE_ROLES);

    // Attachment storage usage + configurable limits (#11).
    const storage = s.attachmentStorage;
    const usedBytes = storage?.usedBytes ?? 0;
    const maxTotalBytes = storage?.maxTotalBytes ?? LIMITS.MAX_ATTACHMENT_STORAGE_TOTAL_DEFAULT;
    const maxFileBytes = storage?.maxFileBytes ?? LIMITS.MAX_ATTACHMENT_FILE_SIZE_DEFAULT;
    const usedPct = maxTotalBytes > 0 ? Math.min(100, Math.round((usedBytes / maxTotalBytes) * 100)) : 0;
    const totalMb = Math.round(maxTotalBytes / (1024 * 1024));
    const fileMb = Math.round(maxFileBytes / (1024 * 1024));
    const barColor = usedPct >= 90 ? 'var(--danger)' : usedPct >= 70 ? '#f0b232' : 'var(--accent-primary)';

    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal-backdrop modal-backdrop--settings';
    this.modalEl.innerHTML = `
      <div class="modal-card settings-modal-card">
        <!-- Sidebar Navigation -->
        <div class="settings-sidebar">
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: var(--text-muted); padding: 4px 10px 8px;">
            ${t('serverSettings.title')}
          </div>
          <button type="button" class="settings-tab-btn active" data-tab="general">
            <span class="material-symbols-outlined md-18">tune</span>
            <span>${t('serverSettings.tabGeneral')}</span>
          </button>
          <button type="button" class="settings-tab-btn" data-tab="security">
            <span class="material-symbols-outlined md-18">lock</span>
            <span>${t('serverSettings.tabSecurity')}</span>
          </button>
          <button type="button" class="settings-tab-btn" data-tab="voice_video">
            <span class="material-symbols-outlined md-18">music_note</span>
            <span>${t('serverSettings.tabVoiceVideo')}</span>
          </button>
          <button type="button" class="settings-tab-btn" data-tab="storage">
            <span class="material-symbols-outlined md-18">cloud</span>
            <span>${t('serverSettings.tabStorage')}</span>
          </button>
          <button type="button" class="settings-tab-btn" data-tab="notifications">
            <span class="material-symbols-outlined md-18">notifications</span>
            <span>${t('serverSettings.tabNotifications')}</span>
          </button>
          ${canManageRoles ? `
          <button type="button" class="settings-tab-btn" data-tab="roles">
            <span class="material-symbols-outlined md-18">admin_panel_settings</span>
            <span>${t('serverSettings.tabRoles')}</span>
          </button>
          ` : ''}
        </div>

        <!-- Main Content Area with Form -->
        <div class="settings-main-container">
          <!-- Top Header -->
          <div class="settings-content-header">
            <button id="modal-close" class="settings-back-btn" title="${t('common.back')}">
              <span class="material-symbols-outlined md-18">arrow_back</span>
              ${t('common.back')}
            </button>
            <div id="server-settings-tab-title" style="font-size: 16px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
              <span class="material-symbols-outlined" style="color: var(--accent-primary);">tune</span>
              <span>${t('serverSettings.tabGeneral')}</span>
            </div>
            <div></div>
          </div>

          <!-- Form wraps body and footer -->
          <form id="form-server-settings" style="display: flex; flex-direction: column; flex: 1; min-height: 0; margin: 0;">
            <!-- Body Scroll Container -->
            <div class="settings-content-body">
              <div id="server-settings-banner" class="error-banner"></div>

              <!-- Tab Panel: Geral -->
              <div class="settings-tab-panel" id="tab-panel-general">
                <div style="display: flex; gap: 16px; align-items: center; padding: 14px; background: var(--bg-card); border-radius: var(--radius-md); margin-bottom: 16px; border: 1px solid var(--border-color);">
                  <div id="server-icon-wrapper" class="settings-avatar-wrapper" style="border-radius: 12px; width: 64px; height: 64px; flex-shrink: 0;" title="${t('serverSettings.iconTitle')}">
                    <img id="server-icon-preview" class="settings-avatar-img" style="border-radius: 10px; width: 64px; height: 64px; object-fit: cover;" src="${s.iconUrl ? getAvatarUrl(s.iconUrl) : logoUrl}" alt="${t('serverSettings.iconAlt')}">
                    <div class="settings-avatar-overlay" style="border-radius: 10px;">
                      <span class="material-symbols-outlined md-20">photo_camera</span>
                    </div>
                  </div>
                  <div style="flex: 1; min-width: 0;">
                    <div class="form-group" style="margin-bottom: 0;">
                      <label style="margin-bottom: 4px;">${t('serverSettings.nameLabel')}</label>
                      <input id="input-server-name" type="text" value="${escapeHtml(s.name)}" required minlength="2" maxlength="50">
                    </div>
                  </div>
                </div>

                <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 14px;">
                  <div style="font-size: 13px; font-weight: 700; color: var(--text-primary); margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
                    <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">info</span>
                    <span>${t('serverSettings.generalInfo')}</span>
                  </div>
                  <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; font-size: 12px; color: var(--text-secondary);">
                    <div><strong>Canais:</strong> ${s.channels.length}</div>
                    <div><strong>Membros:</strong> ${s.members.length}</div>
                    <div style="grid-column: span 2; font-size: 11px; color: var(--text-muted); word-break: break-all;"><strong>ID:</strong> ${s.id}</div>
                  </div>
                </div>
              </div>

              <!-- Tab Panel: Segurança -->
              <div class="settings-tab-panel" id="tab-panel-security" style="display: none;">
                <div style="display: flex; align-items: center; justify-content: space-between; background: var(--bg-card); padding: 12px 14px; border-radius: var(--radius-md); margin-bottom: 16px; border: 1px solid var(--border-color);">
                  <div>
                    <div style="font-size: 13px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
                      <span class="material-symbols-outlined md-18" style="color: ${hasPass ? '#f0b232' : '#23a55a'};">${hasPass ? 'lock' : 'lock_open'}</span>
                      <span>${hasPass ? t('serverSettings.statusProtected') : t('serverSettings.statusOpen')}</span>
                    </div>
                    <div id="password-status-desc" style="font-size: 11px; color: var(--text-muted); margin-top: 2px; margin-left: 24px;">
                      ${hasPass ? t('serverSettings.statusProtectedDesc') : t('serverSettings.statusOpenDesc')}
                    </div>
                  </div>

                  ${hasPass ? `
                    <button type="button" id="btn-remove-pass" class="btn btn-secondary" style="font-size: 11px; padding: 4px 10px; color: var(--danger); border-color: rgba(237, 66, 69, 0.4);">
                      ${t('serverSettings.removePassword')}
                    </button>
                  ` : ''}
                </div>

                <div class="form-group" style="margin-bottom: 4px;">
                  <label id="label-password-field">${hasPass ? t('serverSettings.changePasswordLabel') : t('serverSettings.setPasswordLabel')}</label>
                  <input id="input-server-pass" type="password" placeholder="${hasPass ? t('serverSettings.changePasswordPlaceholder') : t('serverSettings.setPasswordPlaceholder')}">
                </div>
                <div id="pass-help-text" style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
                  ${t('serverSettings.passwordHelp')}
                </div>
              </div>

              <!-- Tab Panel: Voz e Vídeo -->
              <div class="settings-tab-panel" id="tab-panel-voice_video" style="display: none;">
                <div style="display: flex; align-items: center; justify-content: space-between; background: var(--bg-card); padding: 12px 14px; border-radius: var(--radius-md); border: 1px solid var(--border-color);">
                  <div>
                    <label for="checkbox-allow-soundboard" style="font-size: 13px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 6px; cursor: pointer; margin-bottom: 2px;">
                      <span class="material-symbols-outlined md-18" style="color: var(--accent-primary);">music_note</span>
                      <span>${t('serverSettings.allowSoundboard')}</span>
                    </label>
                    <div style="font-size: 11px; color: var(--text-muted);">
                      ${t('serverSettings.allowSoundboardDesc')}
                    </div>
                  </div>
                  <input id="checkbox-allow-soundboard" type="checkbox" ${s.allowSoundboard !== false ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer; accent-color: var(--accent-primary);">
                </div>
              </div>

              <!-- Tab Panel: Armazenamento -->
              <div class="settings-tab-panel" id="tab-panel-storage" style="display: none;">
                <div style="background: var(--bg-card); padding: 14px; border-radius: var(--radius-md); border: 1px solid var(--border-color);">
                  <div style="display: flex; justify-content: space-between; font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">
                    <span>${t('serverSettings.storageUsed', { used: formatBytes(usedBytes), total: formatBytes(maxTotalBytes) })}</span>
                    <span style="font-weight: 600; color: ${barColor};">${usedPct}%</span>
                  </div>
                  <div style="height: 8px; background: var(--bg-input); border-radius: 999px; overflow: hidden; margin-bottom: 4px;">
                    <div style="height: 100%; width: ${usedPct}%; background: ${barColor}; border-radius: 999px; transition: width 0.3s;"></div>
                  </div>
                  <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 14px;">
                    ${t('serverSettings.storageHint')}
                  </div>

                  <div style="display: flex; gap: 12px;">
                    <div class="form-group" style="margin-bottom: 0; flex: 1;">
                      <label style="margin-bottom: 4px; font-size: 12px;">${t('serverSettings.limitPerFile')}</label>
                      <input id="input-attach-file-mb" type="number" min="1" step="1" value="${fileMb}">
                    </div>
                    <div class="form-group" style="margin-bottom: 0; flex: 1;">
                      <label style="margin-bottom: 4px; font-size: 12px;">${t('serverSettings.limitTotal')}</label>
                      <input id="input-attach-total-mb" type="number" min="1" step="1" value="${totalMb}">
                    </div>
                  </div>
                </div>
              </div>

              <!-- Tab Panel: Notificações -->
              <div class="settings-tab-panel" id="tab-panel-notifications" style="display: none;">
                <div style="background: var(--bg-card); padding: 14px; border-radius: var(--radius-md); border: 1px solid var(--border-color);">
                  <label for="select-server-chat-sound" style="font-size: 13px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 6px; margin-bottom: 6px; cursor: pointer;">
                    <span class="material-symbols-outlined md-18" style="color: var(--accent-primary);">notifications</span>
                    <span>${t('serverSettings.chatSoundLabel')}</span>
                  </label>
                  <select id="select-server-chat-sound" style="width: 100%;">
                    <option value="inherit">${t('chatSound.inheritGeneral')}</option>
                    <option value="all">${t('chatSound.all')}</option>
                    <option value="mentions">${t('chatSound.mentions')}</option>
                    <option value="none">${t('chatSound.none')}</option>
                  </select>
                  <div style="font-size: 11px; color: var(--text-muted); margin-top: 8px;">
                    ${t('serverSettings.chatSoundHint')}
                  </div>
                </div>
              </div>

              ${canManageRoles ? `
              <div class="settings-tab-panel" id="tab-panel-roles" style="display: none;">
                ${this.renderRolesTab()}
              </div>
              ` : ''}
            </div>

            <!-- Footer Action Bar -->
            <div class="modal-footer" style="padding: 14px 24px; border-top: 1px solid var(--border-color); background: var(--bg-panel); margin-top: auto; ${canManageServer ? '' : 'justify-content: flex-end;'}">
              <button type="button" id="btn-cancel" class="btn btn-secondary">${t('common.cancel')}</button>
              ${canManageServer ? `<button type="submit" id="btn-save" class="btn btn-primary">${t('serverSettings.save')}</button>` : ''}
            </div>
          </form>
        </div>
      </div>
    `;

    document.body.appendChild(this.modalEl);
    this.attachEvents();
  }

  private attachEvents(): void {
    if (!this.modalEl) return;

    const btnClose = this.modalEl.querySelector('#modal-close');
    const btnCancel = this.modalEl.querySelector('#btn-cancel');
    const btnRemovePass = this.modalEl.querySelector('#btn-remove-pass') as HTMLButtonElement;
    const serverIconWrapper = this.modalEl.querySelector('#server-icon-wrapper');
    const form = this.modalEl.querySelector('#form-server-settings') as HTMLFormElement;
    const inputName = this.modalEl.querySelector('#input-server-name') as HTMLInputElement;
    const inputPass = this.modalEl.querySelector('#input-server-pass') as HTMLInputElement;
    const checkboxAllowSoundboard = this.modalEl.querySelector('#checkbox-allow-soundboard') as HTMLInputElement | null;
    const passHelpText = this.modalEl.querySelector('#pass-help-text') as HTMLElement | null;
    const statusDesc = this.modalEl.querySelector('#password-status-desc') as HTMLElement | null;
    const canManageServer = serverStore.hasPermission(Permission.MANAGE_SERVER);

    btnClose?.addEventListener('click', () => this.close());
    btnCancel?.addEventListener('click', () => this.close());

    // Tab Navigation
    const tabButtons = this.modalEl.querySelectorAll('.settings-tab-btn');
    const tabPanels = this.modalEl.querySelectorAll('.settings-tab-panel');
    const currentTabTitle = this.modalEl.querySelector('#server-settings-tab-title');

    const tabTitles: Record<string, { icon: string; title: string }> = {
      general: { icon: 'tune', title: t('serverSettings.tabGeneral') },
      security: { icon: 'lock', title: t('serverSettings.tabSecurity') },
      voice_video: { icon: 'music_note', title: t('serverSettings.tabVoiceVideo') },
      storage: { icon: 'cloud', title: t('serverSettings.tabStorage') },
      notifications: { icon: 'notifications', title: t('serverSettings.tabNotifications') },
      roles: { icon: 'admin_panel_settings', title: t('serverSettings.tabRoles') },
    };

    const switchTab = (tabName: string) => {
      tabButtons.forEach((btn) => {
        const isTarget = btn.getAttribute('data-tab') === tabName;
        btn.classList.toggle('active', isTarget);
      });
      tabPanels.forEach((panel) => {
        const isTarget = panel.id === `tab-panel-${tabName}`;
        (panel as HTMLElement).style.display = isTarget ? 'flex' : 'none';
      });
      if (currentTabTitle && tabTitles[tabName]) {
        currentTabTitle.innerHTML = `
          <span class="material-symbols-outlined" style="color: var(--accent-primary);">${tabTitles[tabName].icon}</span>
          <span>${tabTitles[tabName].title}</span>
        `;
      }
    };

    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (tab) switchTab(tab);
      });
    });

    // Per-server chat-sound preference (#153). Local-only, so it persists on
    // change rather than waiting for the server-side "Salvar Alterações".
    const selectServerChatSound = this.modalEl.querySelector('#select-server-chat-sound') as HTMLSelectElement | null;
    const serverId = serverStore.serverDetails?.id;
    if (selectServerChatSound && serverId) {
      selectServerChatSound.value = settingsStore.getServerChatSoundOverride(serverId);
      selectServerChatSound.addEventListener('change', () => {
        settingsStore.setServerChatSoundOverride(serverId, selectServerChatSound.value as ChatSoundMode);
      });
    }

    serverIconWrapper?.addEventListener('click', async () => {
      if (!canManageServer) return;
      const s = serverStore.serverDetails;
      const currentIcon = this.pendingIconBase64 !== undefined
        ? this.pendingIconBase64
        : (s?.iconUrl || null);
      const hasCustomIcon = !!currentIcon;

      const action = await this.showIconActionModal(hasCustomIcon);
      if (action === 'change') {
        const file = await window.api.selectImageDialog();
        if (file && file.base64) {
          this.pendingIconBase64 = file.base64;
          const preview = this.modalEl?.querySelector('#server-icon-preview') as HTMLImageElement | null;
          if (preview) preview.src = file.base64;
        }
      } else if (action === 'remove') {
        this.pendingIconBase64 = null;
        const preview = this.modalEl?.querySelector('#server-icon-preview') as HTMLImageElement | null;
        if (preview) preview.src = logoUrl;
      }
    });

    btnRemovePass?.addEventListener('click', () => {
      if (!canManageServer) return;
      this.shouldRemovePassword = true;
      if (inputPass) {
        inputPass.value = '';
        inputPass.placeholder = t('serverSettings.passwordWillBeRemoved');
      }
      if (passHelpText) {
        passHelpText.innerHTML = `<span style="color: var(--danger); font-weight: 600;">${t('serverSettings.passwordRemovalWarning')}</span>`;
      }
      if (statusDesc) {
        statusDesc.innerText = t('serverSettings.markedForRemoval');
      }
      btnRemovePass.style.display = 'none';
    });

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!canManageServer) return;
      const name = inputName?.value.trim();
      const passVal = inputPass?.value;
      const allowSoundboard = checkboxAllowSoundboard ? checkboxAllowSoundboard.checked : true;

      if (!name) return;

      const payload: ServerUpdateSettingsPayload = {
        name,
        allowSoundboard,
      };

      if (this.shouldRemovePassword) {
        payload.password = null;
      } else if (passVal && passVal.trim().length > 0) {
        payload.password = passVal;
      }

      if (this.pendingIconBase64 !== undefined) {
        payload.iconBase64 = this.pendingIconBase64;
      }

      // Attachment storage limits, MB in the UI -> bytes on the wire (#11).
      const inputFileMb = this.modalEl?.querySelector('#input-attach-file-mb') as HTMLInputElement | null;
      const inputTotalMb = this.modalEl?.querySelector('#input-attach-total-mb') as HTMLInputElement | null;
      const fileMbVal = parseFloat(inputFileMb?.value ?? '');
      const totalMbVal = parseFloat(inputTotalMb?.value ?? '');
      if (Number.isFinite(fileMbVal) && fileMbVal > 0) {
        payload.maxAttachmentFileBytes = Math.round(fileMbVal * 1024 * 1024);
      }
      if (Number.isFinite(totalMbVal) && totalMbVal > 0) {
        payload.maxAttachmentStorageBytes = Math.round(totalMbVal * 1024 * 1024);
      }
      if (
        payload.maxAttachmentFileBytes &&
        payload.maxAttachmentStorageBytes &&
        payload.maxAttachmentFileBytes > payload.maxAttachmentStorageBytes
      ) {
        const banner = document.getElementById('server-settings-banner');
        if (banner) {
          banner.innerText = t('serverSettings.limitError');
          banner.classList.add('show');
        }
        return;
      }

      const btnSave = this.modalEl?.querySelector('#btn-save') as HTMLButtonElement;
      if (btnSave) {
        btnSave.disabled = true;
        btnSave.innerText = t('serverSettings.saving');
      }

      try {
        await networkClient.sendRequest(MessageType.SERVER_UPDATE_SETTINGS, payload);
        this.close();
      } catch (err: any) {
        const banner = document.getElementById('server-settings-banner');
        if (banner) {
          banner.innerText = err.message || t('serverSettings.saveError');
          banner.classList.add('show');
        }
        if (btnSave) {
          btnSave.disabled = false;
          btnSave.innerText = t('serverSettings.save');
        }
      }
    });

    this.attachRoleManagementEvents();
  }

  private renderRolesTab(): string {
    const roles = [...serverStore.roles].sort((a, b) => b.position - a.position);
    const members = [...(serverStore.serverDetails?.members ?? [])].sort((a, b) => a.nickname.localeCompare(b.nickname));

    return `
      <div style="display: grid; grid-template-columns: 1.1fr 1fr; gap: 16px; width: 100%;">
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 14px;">
            <div style="font-size: 13px; font-weight: 700; margin-bottom: 10px;">${t('roles.rolesList')}</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 10px;">${t('roles.autoAssignHint')}</div>
            <div id="roles-list" style="display: flex; flex-direction: column; gap: 8px;">
              ${roles.map((role) => `
                <div style="display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center;">
                  <button type="button" class="btn btn-secondary role-item-btn" data-role-id="${role.id}" draggable="true" style="justify-content: space-between; min-width: 0; ${role.color ? `border-left: 4px solid ${role.color};` : ''}">
                    <span style="display: inline-flex; align-items: center; gap: 8px; min-width: 0;">
                      <span class="material-symbols-outlined md-16">drag_indicator</span>
                      <span style="min-width: 0; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(role.name)}</span>
                      ${role.isDefault ? `<span class="member-badge-you">${t('roles.defaultBadge')}</span>` : ''}
                      ${role.name === 'Admin' ? `<span class="member-badge-you">${t('roles.adminBadge')}</span>` : ''}
                    </span>
                    <span style="font-size: 12px; color: var(--text-muted); margin-left: 8px;">${this.describeRolePermissions(role)}</span>
                  </button>
                  <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-secondary); cursor: pointer; white-space: nowrap;">
                    <input type="checkbox" class="role-default-toggle" data-role-id="${role.id}" ${role.isDefault ? 'checked' : ''}>
                    <span>${t('roles.autoAssign')}</span>
                  </label>
                </div>
              `).join('')}
            </div>
          </div>

          <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 14px;">
            <div style="font-size: 13px; font-weight: 700; margin-bottom: 10px;">${t('roles.membersList')}</div>
            <div id="roles-members-list" style="display: flex; flex-direction: column; gap: 8px; max-height: 260px; overflow: auto;">
              ${members.map((member) => `
                <div style="padding: 10px; border: 1px solid var(--border-color); border-radius: var(--radius-md);">
                  <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px;">
                    <span style="font-weight: 600;">${escapeHtml(member.nickname)}</span>
                    <span style="font-size: 11px; color: var(--text-muted);">${escapeHtml(serverStore.getUserRoles(member.id).map((role) => role.name).join(', ') || t('roles.noExtraRoles'))}</span>
                  </div>
                  <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                    ${roles.map((role) => {
                      const assigned = serverStore.getUserRoleIds(member.id).includes(role.id);
                      const disabled = role.isDefault;
                      return `
                        <button type="button" class="btn btn-secondary member-role-toggle" data-user-id="${member.id}" data-role-id="${role.id}" ${disabled ? 'disabled' : ''} style="${role.color ? `border-color: ${role.color};` : ''}">
                          ${assigned ? '✓ ' : ''}${escapeHtml(role.name)}
                        </button>
                      `;
                    }).join('')}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 14px; display: flex; flex-direction: column; gap: 12px;">
          <div style="font-size: 13px; font-weight: 700;">${t('roles.editorTitle')}</div>
          <input type="hidden" id="role-editor-id">
          <div class="form-group" style="margin-bottom: 0;">
            <label>${t('roles.roleName')}</label>
            <input id="role-editor-name" type="text" maxlength="32" placeholder="${t('roles.roleNamePlaceholder')}">
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <label>${t('roles.roleColor')}</label>
            <input id="role-editor-color" type="color" value="#5865f2">
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            ${this.renderPermissionCheckboxes()}
          </div>
          <div style="display: flex; gap: 8px;">
            <button type="button" id="btn-role-save" class="btn btn-primary">${t('roles.createRole')}</button>
            <button type="button" id="btn-role-reset" class="btn btn-secondary">${t('roles.newRole')}</button>
            <button type="button" id="btn-role-delete" class="btn btn-danger">${t('common.delete')}</button>
          </div>
        </div>
      </div>
    `;
  }

  private renderPermissionCheckboxes(): string {
    const items: Array<{ key: Permission; label: string }> = [
      { key: Permission.MANAGE_CHANNELS, label: t('permissions.manageChannels') },
      { key: Permission.MANAGE_SERVER, label: t('permissions.manageServer') },
      { key: Permission.MANAGE_ROLES, label: t('permissions.manageRoles') },
      { key: Permission.KICK_MEMBERS, label: t('permissions.kickMembers') },
      { key: Permission.SPEAK, label: t('permissions.speak') },
      { key: Permission.MUTE_MEMBERS, label: t('permissions.muteMembers') },
      { key: Permission.DEAFEN_MEMBERS, label: t('permissions.deafenMembers') },
      { key: Permission.MOVE_MEMBERS, label: t('permissions.moveMembers') },
      { key: Permission.SEND_MESSAGES, label: t('permissions.sendMessages') },
      { key: Permission.READ_MESSAGES, label: t('permissions.readMessages') },
      { key: Permission.ATTACH_FILES, label: t('permissions.attachFiles') },
      { key: Permission.ADMINISTRATOR, label: t('permissions.administrator') },
    ];

    return items.map((item) => `
      <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer;">
        <input type="checkbox" class="role-permission-checkbox" data-permission="${item.key}">
        <span>${item.label}</span>
      </label>
    `).join('');
  }

  private describeRolePermissions(role: Role): string {
    if (role.permissions & Permission.ADMINISTRATOR) {
      return t('permissions.administrator');
    }
    const labels: string[] = [];
    if (role.permissions & Permission.MANAGE_SERVER) labels.push(t('permissions.manageServer'));
    if (role.permissions & Permission.MANAGE_CHANNELS) labels.push(t('permissions.manageChannels'));
    if (role.permissions & Permission.MANAGE_ROLES) labels.push(t('permissions.manageRoles'));
    if (role.permissions & Permission.SPEAK) labels.push(t('permissions.speak'));
    return labels.slice(0, 3).join(', ') || t('roles.noPermissions');
  }

  private attachRoleManagementEvents(): void {
    if (!this.modalEl || !serverStore.hasPermission(Permission.MANAGE_ROLES)) return;

    const list = this.modalEl.querySelector('#roles-list');
    const inputId = this.modalEl.querySelector('#role-editor-id') as HTMLInputElement | null;
    const inputName = this.modalEl.querySelector('#role-editor-name') as HTMLInputElement | null;
    const inputColor = this.modalEl.querySelector('#role-editor-color') as HTMLInputElement | null;
    const btnSave = this.modalEl.querySelector('#btn-role-save') as HTMLButtonElement | null;
    const btnReset = this.modalEl.querySelector('#btn-role-reset') as HTMLButtonElement | null;
    const btnDelete = this.modalEl.querySelector('#btn-role-delete') as HTMLButtonElement | null;

    const resetEditor = () => {
      if (inputId) inputId.value = '';
      if (inputName) inputName.value = '';
      if (inputColor) inputColor.value = '#5865f2';
      this.modalEl?.querySelectorAll('.role-permission-checkbox').forEach((checkbox) => {
        (checkbox as HTMLInputElement).checked = false;
      });
      if (btnSave) btnSave.innerText = t('roles.createRole');
      if (btnDelete) btnDelete.disabled = true;
    };

    const loadRoleIntoEditor = (role: Role) => {
      if (inputId) inputId.value = role.id;
      if (inputName) inputName.value = role.name;
      if (inputColor) inputColor.value = role.color ?? '#5865f2';
      this.modalEl?.querySelectorAll('.role-permission-checkbox').forEach((checkbox) => {
        const permission = Number((checkbox as HTMLInputElement).dataset.permission || '0');
        (checkbox as HTMLInputElement).checked = (role.permissions & permission) !== 0;
      });
      if (btnSave) btnSave.innerText = t('roles.updateRole');
      if (btnDelete) {
        const isProtected = role.isDefault || role.name === 'Admin';
        btnDelete.disabled = isProtected && serverStore.currentUser?.id !== serverStore.ownerId;
      }
    };

    resetEditor();

    list?.querySelectorAll('.role-item-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const roleId = btn.getAttribute('data-role-id');
        const role = roleId ? serverStore.getRole(roleId) : undefined;
        if (role) loadRoleIntoEditor(role);
      });
      btn.addEventListener('dragstart', () => {
        this.draggedRoleId = btn.getAttribute('data-role-id');
      });
      btn.addEventListener('dragover', (e) => e.preventDefault());
      btn.addEventListener('drop', async () => {
        const targetRoleId = btn.getAttribute('data-role-id');
        if (!this.draggedRoleId || !targetRoleId || this.draggedRoleId === targetRoleId) return;
        const ordered = [...serverStore.roles].sort((a, b) => b.position - a.position);
        const from = ordered.findIndex((role) => role.id === this.draggedRoleId);
        const to = ordered.findIndex((role) => role.id === targetRoleId);
        if (from < 0 || to < 0) return;
        const [moved] = ordered.splice(from, 1);
        ordered.splice(to, 0, moved);
        for (let i = 0; i < ordered.length; i += 1) {
          await networkClient.sendRequest(MessageType.ROLE_UPDATE, {
            roleId: ordered[i].id,
            position: ordered.length - i,
          });
        }
      });
    });

    btnReset?.addEventListener('click', () => resetEditor());
    btnSave?.addEventListener('click', async () => {
      const name = inputName?.value.trim();
      if (!name) return;
      let permissions = 0;
      this.modalEl?.querySelectorAll('.role-permission-checkbox').forEach((checkbox) => {
        const input = checkbox as HTMLInputElement;
        if (input.checked) permissions |= Number(input.dataset.permission || '0');
      });
      const roleId = inputId?.value?.trim();
      if (roleId) {
        await networkClient.sendRequest(MessageType.ROLE_UPDATE, {
          roleId,
          name,
          color: inputColor?.value || null,
          permissions,
        });
      } else {
        await networkClient.sendRequest(MessageType.ROLE_CREATE, {
          name,
          color: inputColor?.value || null,
          permissions,
        });
      }
      this.close();
      this.open();
    });

    btnDelete?.addEventListener('click', async () => {
      const roleId = inputId?.value?.trim();
      if (!roleId || btnDelete.disabled) return;
      await networkClient.sendRequest(MessageType.ROLE_DELETE, { roleId });
      this.close();
      this.open();
    });

    this.modalEl.querySelectorAll('.member-role-toggle').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = btn.getAttribute('data-user-id');
        const roleId = btn.getAttribute('data-role-id');
        if (!userId || !roleId) return;
        const assigned = serverStore.getUserRoleIds(userId).includes(roleId);
        await networkClient.sendRequest(assigned ? MessageType.ROLE_UNASSIGN : MessageType.ROLE_ASSIGN, { userId, roleId });
        this.close();
        this.open();
      });
    });

    this.modalEl.querySelectorAll('.role-default-toggle').forEach((toggle) => {
      toggle.addEventListener('change', async () => {
        const input = toggle as HTMLInputElement;
        const roleId = input.getAttribute('data-role-id');
        if (!roleId) return;
        await networkClient.sendRequest(MessageType.ROLE_UPDATE, {
          roleId,
          isDefault: input.checked,
        });
        this.close();
        this.open();
      });
    });
  }

  private showIconActionModal(hasCustomIcon: boolean): Promise<'change' | 'remove' | null> {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.style.zIndex = '10001';
      backdrop.innerHTML = `
        <div class="modal-card dialog-card" role="dialog" aria-modal="true" style="max-width: 380px;">
          <div class="modal-header">
            <div class="modal-title" style="display: flex; align-items: center; gap: 8px;">
              <span class="material-symbols-outlined" style="color: var(--accent-primary);">photo_camera</span>
              <span>${t('serverSettings.photoDialogTitle')}</span>
            </div>
            <button class="modal-close-btn" data-action="cancel">&times;</button>
          </div>
          <div class="dialog-message" style="margin-bottom: 20px; white-space: normal;">${t('serverSettings.photoDialogPrompt')}</div>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <button type="button" class="btn btn-primary" data-action="change" style="justify-content: center; gap: 8px; height: 38px;">
              <span class="material-symbols-outlined md-18">upload</span>
              <span>${t('settings.avatarChange')}</span>
            </button>
            ${
              hasCustomIcon
                ? `
            <button type="button" class="btn btn-danger" data-action="remove" style="justify-content: center; gap: 8px; height: 38px;">
              <span class="material-symbols-outlined md-18">delete</span>
              <span>${t('settings.avatarRemove')}</span>
            </button>
            `
                : ''
            }
            <button type="button" class="btn btn-secondary" data-action="cancel" style="justify-content: center; height: 38px;">${t('common.cancel')}</button>
          </div>
        </div>
      `;

      const settle = (result: 'change' | 'remove' | null) => {
        document.removeEventListener('keydown', onKeyDown, true);
        backdrop.remove();
        resolve(result);
      };

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          settle(null);
        }
      };

      backdrop.querySelectorAll('[data-action="change"]').forEach((el) => {
        el.addEventListener('click', () => settle('change'));
      });
      backdrop.querySelectorAll('[data-action="remove"]').forEach((el) => {
        el.addEventListener('click', () => settle('remove'));
      });
      backdrop.querySelectorAll('[data-action="cancel"]').forEach((el) => {
        el.addEventListener('click', () => settle(null));
      });
      backdrop.addEventListener('mousedown', (e) => {
        if (e.target === backdrop) settle(null);
      });
      document.addEventListener('keydown', onKeyDown, true);

      document.body.appendChild(backdrop);
    });
  }

  public close(): void {
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
      this.shouldRemovePassword = false;
      this.pendingIconBase64 = undefined;
    }
  }
}

export const serverSettingsModal = new ServerSettingsModal();
