class MembersView {
  private searchTerm = '';

  constructor(private container: HTMLElement) {}

  public render(
    members: GuiMember[],
    status: GuiStatus,
    actions: {
      onToggleAdmin: (member: GuiMember) => Promise<void>;
      onKick: (member: GuiMember) => Promise<void>;
      busyMemberId: string | null;
    }
  ): void {
    const filtered = members.filter((member) => {
      const haystack = `${member.nickname} ${member.clientId} ${member.roles.join(' ')}`.toLowerCase();
      return haystack.includes(this.searchTerm.toLowerCase());
    });

    this.container.innerHTML = `
      <div class="content-header">
        <div>
          <h2>Membros</h2>
          <div class="content-subtitle">${members.length} membros registrados • ${status.connectedUsers} online agora</div>
        </div>
        <input id="members-search" class="input" style="max-width: 320px;" placeholder="Buscar por nickname, id ou cargo" value="${escapeHtml(this.searchTerm)}" />
      </div>

      <div class="member-list">
        ${filtered.length === 0 ? '<div class="empty-state">Nenhum membro encontrado.</div>' : filtered.map((member) => this.renderMember(member, status.running, actions.busyMemberId === member.id)).join('')}
      </div>
    `;

    getElement<HTMLInputElement>('members-search')?.addEventListener('input', (event) => {
      this.searchTerm = (event.target as HTMLInputElement).value;
      this.render(members, status, actions);
    });

    for (const member of filtered) {
      getElement<HTMLButtonElement>(`member-admin-${member.id}`)?.addEventListener('click', () => {
        void actions.onToggleAdmin(member);
      });
      getElement<HTMLButtonElement>(`member-kick-${member.id}`)?.addEventListener('click', () => {
        void actions.onKick(member);
      });
    }
  }

  private renderMember(member: GuiMember, running: boolean, busy: boolean): string {
    return `
      <div class="member-card">
        <div class="member-main">
          <div class="member-title">
            <span class="status-dot ${member.online ? 'running' : ''}"></span>
            <span>${escapeHtml(member.nickname)}</span>
          </div>
          <div class="member-meta">
            <span>ID: ${escapeHtml(truncateId(member.clientId))}</span>
            <span>${member.online ? 'Online' : 'Offline'}</span>
            <span>Último acesso: ${escapeHtml(formatDateTime(member.lastSeenAt))}</span>
          </div>
          <div class="chip-row">
            ${member.roles.length > 0 ? member.roles.map((role) => `<span class="chip ${role.toLowerCase() === 'admin' ? 'admin' : ''}">${escapeHtml(role)}</span>`).join('') : '<span class="chip">Sem cargos</span>'}
          </div>
        </div>
        <div class="button-row">
          <button class="btn" id="member-admin-${member.id}" ${busy ? 'disabled' : ''}>${member.isAdmin ? 'Remover admin' : 'Tornar admin'}</button>
          <button class="btn danger" id="member-kick-${member.id}" ${!running || !member.online || busy ? 'disabled' : ''}>Expulsar</button>
        </div>
      </div>
    `;
  }
}
