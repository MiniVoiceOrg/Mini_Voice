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
  private activeTab = 'general';

  public open(): void {
    this.activeTab = 'general';
    this.render();
  }

  /**
   * Rebuilds the modal after a role/member mutation while staying on the tab the
   * user was working in, instead of dropping them back on General (#260).
   */
  private reopenPreservingTab(): void {
    const tab = this.activeTab;
    this.render();
    this.activeTab = tab;
    this.applyActiveTab();
  }

  private applyActiveTab(): void {
    const btn = this.modalEl?.querySelector<HTMLElement>(`.settings-tab-btn[data-tab="${this.activeTab}"]`);
    btn?.click();
  }

  private render(): void {
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
          <button type="button" class="settings-tab-btn" data-tab="members">
            <span class="material-symbols-outlined md-18">group</span>
            <span>${t('serverSettings.tabMembers')}</span>
          </button>
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
            <div id="server-settings-tab-title" style="font-size: 16px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
              <span class="material-symbols-outlined" style="color: var(--accent-primary);">tune</span>
              <span>${t('serverSettings.tabGeneral')}</span>
            </div>
            <button id="modal-close" class="settings-back-btn" title="${t('common.back')} (ESC)">
              <span class="material-symbols-outlined md-18">close</span>
              <span class="esc-hint">ESC</span>
            </button>
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
                  <label class="toggle-switch" aria-label="${t('serverSettings.allowSoundboard')}">
                    <input id="checkbox-allow-soundboard" type="checkbox" ${s.allowSoundboard !== false ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                  </label>
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
              <div class="settings-tab-panel" id="tab-panel-members" style="display: none;">
                ${this.renderMembersTab()}
              </div>
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

    // Close on ESC key (#243)
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { this.close(); }
    };
    window.addEventListener('keydown', handleEsc);
    (this.modalEl as any)._escHandler = handleEsc;

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
      members: { icon: 'group', title: t('serverSettings.tabMembers') },
      roles: { icon: 'admin_panel_settings', title: t('serverSettings.tabRoles') },
    };

    const switchTab = (tabName: string) => {
      this.activeTab = tabName;
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

  private renderMembersTab(): string {
    const roles = [...serverStore.roles].sort((a, b) => b.position - a.position);
    // Admin is toggled through its own action, never listed as a role (#265).
    const manageableRoles = roles.filter((role) => !role.isDefault && !serverStore.isAdminRole(role));
    const adminRole = serverStore.getAdminRole();
    const members = [...(serverStore.serverDetails?.members ?? [])].sort((a, b) => a.nickname.localeCompare(b.nickname));
    const canKickMembers = serverStore.hasPermission(Permission.KICK_MEMBERS);

    return `
      <div style="display: flex; flex-direction: column; gap: 16px; width: 100%;">
        <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 14px; overflow: visible;">
          <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; flex-wrap: wrap;">
            <div>
              <div style="font-size: 13px; font-weight: 700; margin-bottom: 4px;">${t('roles.membersList')}</div>
              <div style="font-size: 11px; color: var(--text-muted);">${t('roles.membersTableHint')}</div>
            </div>
          </div>
          <div class="settings-table-wrap">
            <table class="settings-data-table">
              <thead>
                <tr>
                  <th>${t('roles.memberColumn')}</th>
                  <th>${t('roles.rolesColumn')}</th>
                  <th style="width: 96px; text-align: right;">${t('roles.actionsColumn')}</th>
                </tr>
              </thead>
              <tbody>
            ${members.map((member) => {
              const userRoles = serverStore.getUserRoles(member.id).filter((role) => !role.isDefault);
              const visibleRoles = userRoles.slice(0, 2);
              const extraRoles = userRoles.length - visibleRoles.length;
              const avatar = getAvatarUrl(member.avatarUrl);
              const isAdmin = !!adminRole && serverStore.getUserRoleIds(member.id).includes(adminRole.id);
              const isOwner = member.id === serverStore.ownerId;

              return `
                <tr>
                  <td>
                    <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                      <img src="${avatar}" alt="${escapeHtml(member.nickname)}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border-color); flex-shrink: 0;">
                      <div style="min-width: 0; display: flex; flex-direction: column; gap: 4px;">
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0;">
                          <span style="font-size: 13px; font-weight: 600; color: var(--text-primary); min-width: 0; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(member.nickname)}</span>
                          ${member.id === serverStore.currentUser?.id ? `<span class="member-badge-you">${t('common.you')}</span>` : ''}
                          ${isOwner ? `<span class="member-badge-you">${t('roles.ownerBadge')}</span>` : ''}
                          ${isAdmin ? `<span class="member-badge-you" style="background: rgba(88, 101, 242, 0.18); color: var(--accent-primary);">${t('roles.adminBadge')}</span>` : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    ${visibleRoles.length
                      ? `
                        <div class="member-role-tags">
                          ${visibleRoles.map((role) => `<span class="member-role-tag" style="${role.color ? `--role-color: ${role.color}` : ''}">${escapeHtml(role.name)}</span>`).join('')}
                          ${extraRoles > 0 ? `<span class="member-badge-you" style="background: rgba(255, 255, 255, 0.08); color: var(--text-secondary);">${t('roles.moreRoles', { count: extraRoles })}</span>` : ''}
                        </div>
                      `
                      : `<span style="font-size: 11px; color: var(--text-muted);">${t('roles.noExtraRoles')}</span>`}
                  </td>
                  <td style="text-align: right;">
                    <div class="settings-action-menu-wrap">
                      <button type="button" class="btn btn-secondary btn-icon member-actions-trigger" data-user-id="${member.id}" title="${t('common.moreOptions')}" style="width: 32px; height: 32px; padding: 0; justify-content: center;">
                        <span class="material-symbols-outlined md-18">more_horiz</span>
                      </button>
                      <div class="settings-action-menu">
                        ${canKickMembers ? `
                          <button type="button" class="settings-action-menu-item danger" data-member-action="kick" data-user-id="${member.id}" ${isOwner ? 'disabled' : ''}>
                            ${t('userMenu.kickMember')}
                          </button>
                        ` : ''}
                        ${adminRole ? `
                          <button type="button" class="settings-action-menu-item" data-member-action="toggle-admin" data-user-id="${member.id}" data-role-id="${adminRole.id}" ${isOwner ? 'disabled' : ''}>
                            <span class="material-symbols-outlined md-16">${isAdmin ? 'check_box' : 'check_box_outline_blank'}</span>
                            <span>${t('userMenu.makeAdmin')}</span>
                          </button>
                        ` : ''}
                        <div class="settings-action-submenu-wrap">
                          <button type="button" class="settings-action-menu-item" ${manageableRoles.length ? '' : 'disabled'}>
                            <span>${t('userMenu.rolesSubmenu')}</span>
                            <span class="material-symbols-outlined md-16">chevron_left</span>
                          </button>
                          ${manageableRoles.length ? `
                            <div class="settings-action-submenu">
                              ${manageableRoles.map((role) => {
                                const assigned = serverStore.getUserRoleIds(member.id).includes(role.id);
                                return `
                                  <button type="button" class="settings-action-menu-item" data-member-action="toggle-role" data-user-id="${member.id}" data-role-id="${role.id}" ${isOwner ? 'disabled' : ''}>
                                    <span class="material-symbols-outlined md-16">${assigned ? 'check_box' : 'check_box_outline_blank'}</span>
                                    <span style="${role.color ? `color: ${role.color};` : ''}">${escapeHtml(role.name)}</span>
                                  </button>
                                `;
                              }).join('')}
                            </div>
                          ` : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  private renderRolesTab(): string {
    // Admin is a permission state, not a listable role (#265).
    const roles = serverStore.getVisibleRoles().sort((a, b) => b.position - a.position);
    const members = serverStore.serverDetails?.members ?? [];

    return `
      <div style="display: flex; flex-direction: column; gap: 16px; width: 100%;">
        <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 14px; display: flex; flex-direction: column; gap: 12px; overflow: visible;">
          <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
            <div>
              <div style="font-size: 13px; font-weight: 700; margin-bottom: 4px;">${t('roles.rolesList')}</div>
              <div style="font-size: 11px; color: var(--text-muted);">${t('roles.dragReorderHint')}</div>
            </div>
            <button type="button" id="btn-role-create-new" class="btn btn-primary">${t('roles.createRole')}</button>
          </div>
          <div class="settings-table-wrap">
            <table id="roles-list" class="settings-data-table">
              <thead>
                <tr>
                  <th>${t('roles.roleColumn')}</th>
                  <th>${t('roles.permissionsColumn')}</th>
                  <th style="width: 120px;">${t('roles.membersColumn')}</th>
                  <th style="width: 110px; text-align: right;">${t('roles.actionsColumn')}</th>
                </tr>
              </thead>
              <tbody>
                ${roles.map((role) => {
                  const assignedMembers = members.filter((member) => serverStore.getUserRoleIds(member.id).includes(role.id)).length;
                  return `
                    <tr class="role-table-row" data-role-id="${role.id}" draggable="true">
                      <td>
                        <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                          <span class="material-symbols-outlined md-16" title="${t('roles.dragReorderHint')}" style="color: var(--text-muted); cursor: grab; flex-shrink: 0;">drag_indicator</span>
                          <span style="width: 12px; height: 12px; border-radius: 50%; background: ${role.color || 'var(--text-muted)'}; border: 1px solid rgba(255, 255, 255, 0.12); flex-shrink: 0;"></span>
                          <span style="font-size: 13px; font-weight: 600; color: var(--text-primary); min-width: 0; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(role.name)}</span>
                          ${role.isDefault ? `<span class="member-badge-you" style="background: rgba(35, 165, 90, 0.18); color: var(--success);">${t('roles.autoBadge')}</span>` : ''}
                        </div>
                      </td>
                      <td style="font-size: 12px; color: var(--text-secondary);">${escapeHtml(this.describeRolePermissions(role))}</td>
                      <td style="font-size: 12px; color: var(--text-secondary);">${assignedMembers}</td>
                      <td style="text-align: right;">
                        <button type="button" class="btn btn-secondary role-open-btn" data-role-open="${role.id}">${t('common.edit')}</button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div id="role-editor-section" style="display: none; background: var(--bg-card); border: 1px solid color-mix(in srgb, var(--accent-primary) 35%, var(--border-color)); border-radius: var(--radius-md); padding: 16px; flex-direction: column; gap: 14px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);">
          <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
            <div>
              <div id="role-editor-title" style="font-size: 15px; font-weight: 700; color: var(--text-primary);">${t('roles.editorNewTitle')}</div>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">${t('roles.editorPanelHint')}</div>
            </div>
          </div>
          <input type="hidden" id="role-editor-id">
          <div style="display: flex; gap: 8px; flex-wrap: wrap; border-bottom: 1px solid var(--border-color); padding-bottom: 6px;">
            <button type="button" class="role-editor-tab-btn active" data-role-editor-tab="display">${t('roles.displayTab')}</button>
            <button type="button" class="role-editor-tab-btn" data-role-editor-tab="permissions">${t('roles.permissionsTab')}</button>
            <button type="button" class="role-editor-tab-btn" data-role-editor-tab="members">${t('roles.membersTab')}</button>
          </div>
          <div id="role-editor-tab-display" class="role-editor-tab-panel" style="display: flex; flex-direction: column; gap: 12px;">
            <div class="form-group" style="margin-bottom: 0;">
              <label>${t('roles.roleName')}</label>
              <input id="role-editor-name" type="text" maxlength="32" placeholder="${t('roles.roleNamePlaceholder')}">
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              <div style="font-size: 12px; font-weight: 600; color: var(--text-primary);">${t('roles.roleColor')}</div>
              <div style="font-size: 11px; color: var(--text-muted);">${t('roles.colorPaletteHint')}</div>
              ${this.renderRoleColorPalette('#5865f2')}
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-secondary);">
              <div style="min-width: 0;">
                <div style="font-size: 12px; font-weight: 600; color: var(--text-primary);">${t('roles.autoAssign')}</div>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${t('roles.autoAssignEditorHint')}</div>
              </div>
              <label class="permission-switch" aria-label="${t('roles.autoAssign')}">
                <input type="checkbox" id="role-editor-is-default">
                <span class="slider"></span>
              </label>
            </div>
          </div>
          <div id="role-editor-tab-permissions" class="role-editor-tab-panel" style="display: none; flex-direction: column; gap: 10px;">
            ${this.renderPermissionSwitches()}
          </div>
          <div id="role-editor-tab-members" class="role-editor-tab-panel" style="display: none; flex-direction: column; gap: 10px;">
            <div id="role-editor-members-panel">${this.renderRoleMembersEditorPanel()}</div>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end;">
            <button type="button" id="btn-role-cancel" class="btn btn-secondary">${t('common.cancel')}</button>
            <button type="button" id="btn-role-delete" class="btn btn-danger">${t('common.delete')}</button>
            <button type="button" id="btn-role-save" class="btn btn-primary">${t('roles.createRole')}</button>
          </div>
        </div>
      </div>
    `;
  }

  private renderPermissionSwitches(): string {
    const items: Array<{ key: Permission; label: string; description: string }> = [
      { key: Permission.MANAGE_CHANNELS, label: t('permissions.manageChannels'), description: t('permissions.manageChannelsDesc') },
      { key: Permission.MANAGE_SERVER, label: t('permissions.manageServer'), description: t('permissions.manageServerDesc') },
      { key: Permission.MANAGE_ROLES, label: t('permissions.manageRoles'), description: t('permissions.manageRolesDesc') },
      { key: Permission.KICK_MEMBERS, label: t('permissions.kickMembers'), description: t('permissions.kickMembersDesc') },
      { key: Permission.SPEAK, label: t('permissions.speak'), description: t('permissions.speakDesc') },
      { key: Permission.MUTE_MEMBERS, label: t('permissions.muteMembers'), description: t('permissions.muteMembersDesc') },
      { key: Permission.DEAFEN_MEMBERS, label: t('permissions.deafenMembers'), description: t('permissions.deafenMembersDesc') },
      { key: Permission.MOVE_MEMBERS, label: t('permissions.moveMembers'), description: t('permissions.moveMembersDesc') },
      { key: Permission.SEND_MESSAGES, label: t('permissions.sendMessages'), description: t('permissions.sendMessagesDesc') },
      { key: Permission.READ_MESSAGES, label: t('permissions.readMessages'), description: t('permissions.readMessagesDesc') },
      { key: Permission.ATTACH_FILES, label: t('permissions.attachFiles'), description: t('permissions.attachFilesDesc') },
      { key: Permission.ADMINISTRATOR, label: t('permissions.administrator'), description: t('permissions.administratorDesc') },
    ];

    return items.map((item) => `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-secondary);">
        <div style="min-width: 0;">
          <div style="font-size: 12px; font-weight: 600; color: var(--text-primary);">${item.label}</div>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${item.description}</div>
        </div>
        <label class="permission-switch" aria-label="${item.label}">
          <input type="checkbox" class="role-permission-switch" data-permission="${item.key}">
          <span class="slider"></span>
        </label>
      </div>
    `).join('');
  }

  private getRoleColorPalette(): string[] {
    return [
      '#5865f2',
      '#57f287',
      '#fee75c',
      '#eb459e',
      '#ed4245',
      '#f47b67',
      '#9b59b6',
      '#1abc9c',
      '#3498db',
      '#e91e63',
      '#95a5a6',
      '#e67e22',
    ];
  }

  private renderRoleColorPalette(selectedColor: string): string {
    return `
      <input type="hidden" id="role-editor-color" value="${selectedColor}">
      <div style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-secondary); margin-bottom: 10px;">
        <span id="role-editor-color-preview" style="width: 16px; height: 16px; border-radius: 50%; background: ${selectedColor}; border: 1px solid rgba(255, 255, 255, 0.14); flex-shrink: 0;"></span>
        <span id="role-editor-color-code" style="font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono);">${selectedColor}</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px;">
        ${this.getRoleColorPalette().map((color) => `
          <button type="button" class="role-color-swatch ${color === selectedColor ? 'active' : ''}" data-role-color="${color}" style="--role-swatch-color: ${color};" title="${color}" aria-label="${color}"></button>
        `).join('')}
      </div>
    `;
  }

  private renderRoleMembersEditorPanel(roleId?: string): string {
    if (!roleId) {
      return `
        <div style="padding: 16px; border: 1px dashed var(--border-color); border-radius: var(--radius-md); background: var(--bg-secondary); font-size: 12px; color: var(--text-muted); text-align: center;">
          ${t('roles.membersTabHint')}
        </div>
      `;
    }

    const members = [...(serverStore.serverDetails?.members ?? [])].sort((a, b) => a.nickname.localeCompare(b.nickname));

    return `
      <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 10px;">${t('roles.membersEditorHint')}</div>
      <div class="settings-table-wrap">
        <table class="settings-data-table">
          <thead>
            <tr>
              <th>${t('roles.memberColumn')}</th>
              <th style="width: 100px; text-align: center;">${t('roles.assignedColumn')}</th>
            </tr>
          </thead>
          <tbody>
            ${members.map((member) => {
              const assigned = serverStore.getUserRoleIds(member.id).includes(roleId);
              return `
                <tr>
                  <td>
                    <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                      <img src="${getAvatarUrl(member.avatarUrl)}" alt="${escapeHtml(member.nickname)}" style="width: 34px; height: 34px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border-color); flex-shrink: 0;">
                      <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0;">
                        <span style="font-size: 13px; font-weight: 600; color: var(--text-primary); min-width: 0; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(member.nickname)}</span>
                        ${member.id === serverStore.currentUser?.id ? `<span class="member-badge-you">${t('common.you')}</span>` : ''}
                        ${member.id === serverStore.ownerId ? `<span class="member-badge-you">${t('roles.ownerBadge')}</span>` : ''}
                      </div>
                    </div>
                  </td>
                  <td style="text-align: center;">
                    <label class="permission-switch" aria-label="${t('roles.assignedColumn')}">
                      <input type="checkbox" class="role-editor-member-switch" data-user-id="${member.id}" data-role-id="${roleId}" ${assigned ? 'checked' : ''}>
                      <span class="slider"></span>
                    </label>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
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

    const list = this.modalEl.querySelector('#roles-list') as HTMLElement | null;
    const editorSection = this.modalEl.querySelector('#role-editor-section') as HTMLElement | null;
    const editorTitle = this.modalEl.querySelector('#role-editor-title') as HTMLElement | null;
    const editorMembersPanel = this.modalEl.querySelector('#role-editor-members-panel') as HTMLElement | null;
    const inputId = this.modalEl.querySelector('#role-editor-id') as HTMLInputElement | null;
    const inputName = this.modalEl.querySelector('#role-editor-name') as HTMLInputElement | null;
    const inputColor = this.modalEl.querySelector('#role-editor-color') as HTMLInputElement | null;
    const inputAutoAssign = this.modalEl.querySelector('#role-editor-is-default') as HTMLInputElement | null;
    const colorPreview = this.modalEl.querySelector('#role-editor-color-preview') as HTMLElement | null;
    const colorCode = this.modalEl.querySelector('#role-editor-color-code') as HTMLElement | null;
    const btnCreateNew = this.modalEl.querySelector('#btn-role-create-new') as HTMLButtonElement | null;
    const btnSave = this.modalEl.querySelector('#btn-role-save') as HTMLButtonElement | null;
    const btnDelete = this.modalEl.querySelector('#btn-role-delete') as HTMLButtonElement | null;
    const btnRoleCancel = this.modalEl.querySelector('#btn-role-cancel') as HTMLButtonElement | null;
    const palette = this.getRoleColorPalette();

    const closeActionMenus = () => {
      this.modalEl?.querySelectorAll('.settings-action-menu.show').forEach((menu) => menu.classList.remove('show'));
    };

    const syncColorState = (selectedColor: string) => {
      if (inputColor) inputColor.value = selectedColor;
      if (colorPreview) colorPreview.style.background = selectedColor;
      if (colorCode) colorCode.textContent = selectedColor;
      this.modalEl?.querySelectorAll('.role-color-swatch').forEach((swatch) => {
        swatch.classList.toggle('active', (swatch as HTMLElement).dataset.roleColor === selectedColor);
      });
    };

    const switchEditorTab = (tabName: string) => {
      this.modalEl?.querySelectorAll('.role-editor-tab-btn').forEach((btn) => {
        btn.classList.toggle('active', (btn as HTMLElement).dataset.roleEditorTab === tabName);
      });
      this.modalEl?.querySelectorAll('.role-editor-tab-panel').forEach((panel) => {
        const element = panel as HTMLElement;
        element.style.display = element.id === `role-editor-tab-${tabName}` ? 'flex' : 'none';
      });
    };

    const setEditorVisible = (visible: boolean) => {
      if (editorSection) {
        editorSection.style.display = visible ? 'flex' : 'none';
        if (visible) {
          editorSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    };

    const resetEditor = (showEditor = false) => {
      if (inputId) inputId.value = '';
      if (inputName) inputName.value = '';
      if (inputAutoAssign) inputAutoAssign.checked = false;
      this.modalEl?.querySelectorAll('.role-permission-switch').forEach((checkbox) => {
        (checkbox as HTMLInputElement).checked = false;
      });
      syncColorState(palette[0]);
      if (editorTitle) editorTitle.textContent = t('roles.editorNewTitle');
      if (editorMembersPanel) editorMembersPanel.innerHTML = this.renderRoleMembersEditorPanel();
      if (btnSave) btnSave.innerText = t('roles.createRole');
      if (btnDelete) btnDelete.disabled = true;
      switchEditorTab('display');
      setEditorVisible(showEditor);
    };

    const loadRoleIntoEditor = (role: Role) => {
      setEditorVisible(true);
      if (inputId) inputId.value = role.id;
      if (inputName) inputName.value = role.name;
      if (inputAutoAssign) inputAutoAssign.checked = role.isDefault;
      syncColorState(role.color ?? palette[0]);
      this.modalEl?.querySelectorAll('.role-permission-switch').forEach((checkbox) => {
        const input = checkbox as HTMLInputElement;
        const permission = Number(input.dataset.permission || '0');
        input.checked = (role.permissions & permission) !== 0;
      });
      if (editorTitle) editorTitle.textContent = t('roles.editorEditTitle', { name: role.name });
      if (editorMembersPanel) editorMembersPanel.innerHTML = this.renderRoleMembersEditorPanel(role.id);
      if (btnSave) btnSave.innerText = t('roles.updateRole');
      if (btnDelete) {
        const isProtected = role.isDefault || serverStore.isAdminRole(role);
        btnDelete.disabled = isProtected && serverStore.currentUser?.id !== serverStore.ownerId;
      }
      switchEditorTab('display');
    };

    resetEditor(false);
    btnCreateNew?.addEventListener('click', () => resetEditor(true));
    btnRoleCancel?.addEventListener('click', () => resetEditor(false));

    list?.querySelectorAll('.role-table-row').forEach((row) => {
      row.addEventListener('dragstart', () => {
        this.draggedRoleId = row.getAttribute('data-role-id');
      });
      row.addEventListener('dragend', () => {
        this.draggedRoleId = null;
      });
      row.addEventListener('dragover', (e) => e.preventDefault());
      row.addEventListener('drop', async () => {
        const targetRoleId = row.getAttribute('data-role-id');
        if (!this.draggedRoleId || !targetRoleId || this.draggedRoleId === targetRoleId) return;
        // Reorder only the roles actually listed, so the hidden Admin role never
        // shifts around as a side effect (#262, #265).
        const ordered = serverStore.getVisibleRoles().sort((a, b) => b.position - a.position);
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
        this.reopenPreservingTab();
      });
    });

    btnSave?.addEventListener('click', async () => {
      const name = inputName?.value.trim();
      if (!name) return;
      let permissions = 0;
      this.modalEl?.querySelectorAll('.role-permission-switch').forEach((checkbox) => {
        const input = checkbox as HTMLInputElement;
        if (input.checked) permissions |= Number(input.dataset.permission || '0');
      });
      const roleId = inputId?.value?.trim();
      const payload = {
        name,
        color: inputColor?.value || palette[0],
        permissions,
        isDefault: !!inputAutoAssign?.checked,
      };
      if (roleId) {
        await networkClient.sendRequest(MessageType.ROLE_UPDATE, {
          roleId,
          ...payload,
        });
      } else {
        await networkClient.sendRequest(MessageType.ROLE_CREATE, payload);
      }
      this.reopenPreservingTab();
    });

    btnDelete?.addEventListener('click', async () => {
      const roleId = inputId?.value?.trim();
      if (!roleId || btnDelete.disabled) return;
      await networkClient.sendRequest(MessageType.ROLE_DELETE, { roleId });
      this.reopenPreservingTab();
    });

    this.modalEl.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;

      const roleOpenButton = target.closest('[data-role-open]') as HTMLElement | null;
      if (roleOpenButton) {
        const roleId = roleOpenButton.getAttribute('data-role-open');
        const role = roleId ? serverStore.getRole(roleId) : undefined;
        if (role) loadRoleIntoEditor(role);
        return;
      }

      const tabButton = target.closest('.role-editor-tab-btn') as HTMLElement | null;
      if (tabButton?.dataset.roleEditorTab) {
        switchEditorTab(tabButton.dataset.roleEditorTab);
        return;
      }

      const swatch = target.closest('.role-color-swatch') as HTMLElement | null;
      if (swatch?.dataset.roleColor) {
        syncColorState(swatch.dataset.roleColor);
        return;
      }

      const menuTrigger = target.closest('.member-actions-trigger') as HTMLElement | null;
      if (menuTrigger) {
        event.preventDefault();
        event.stopPropagation();
        const menu = menuTrigger.parentElement?.querySelector('.settings-action-menu');
        const willShow = !menu?.classList.contains('show');
        closeActionMenus();
        if (willShow) menu?.classList.add('show');
        return;
      }

      // Click-based submenu toggle for roles (#242)
      const submenuTrigger = target.closest('.settings-action-submenu-wrap > .settings-action-menu-item:not([data-member-action])') as HTMLElement | null;
      if (submenuTrigger) {
        event.preventDefault();
        event.stopPropagation();
        const wrap = submenuTrigger.closest('.settings-action-submenu-wrap');
        wrap?.classList.toggle('open');
        return;
      }

      const menuAction = target.closest('[data-member-action]') as HTMLElement | null;
      if (menuAction) {
        event.preventDefault();
        event.stopPropagation();
        if (menuAction.hasAttribute('disabled')) return;
        const userId = menuAction.getAttribute('data-user-id');
        const roleId = menuAction.getAttribute('data-role-id');
        const action = menuAction.getAttribute('data-member-action');
        if (!userId || !action) return;

        void (async () => {
          if (action === 'kick') {
            await networkClient.sendRequest(MessageType.MEMBER_KICK, { targetUserId: userId });
          }
          if (action === 'toggle-admin' || action === 'toggle-role') {
            if (!roleId) return;
            const assigned = serverStore.getUserRoleIds(userId).includes(roleId);
            await networkClient.sendRequest(assigned ? MessageType.ROLE_UNASSIGN : MessageType.ROLE_ASSIGN, { userId, roleId });
          }
          this.reopenPreservingTab();
        })();
        return;
      }

      if (!target.closest('.settings-action-menu-wrap')) {
        closeActionMenus();
      }
    });

    this.modalEl.addEventListener('change', (event) => {
      const target = event.target as HTMLElement;
      if (!(target instanceof HTMLInputElement)) return;
      if (!target.classList.contains('role-editor-member-switch')) return;
      const userId = target.getAttribute('data-user-id');
      const roleId = target.getAttribute('data-role-id');
      if (!userId || !roleId) return;
      void (async () => {
        await networkClient.sendRequest(target.checked ? MessageType.ROLE_ASSIGN : MessageType.ROLE_UNASSIGN, { userId, roleId });
        this.reopenPreservingTab();
      })();
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
      const handler = (this.modalEl as any)._escHandler;
      if (handler) window.removeEventListener('keydown', handler);
      this.modalEl.remove();
      this.modalEl = null;
      this.shouldRemovePassword = false;
      this.pendingIconBase64 = undefined;
    }
  }
}

export const serverSettingsModal = new ServerSettingsModal();
