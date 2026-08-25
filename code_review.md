# 🔬 Code Review — Monky (NovoDiscord)

> **Revisão completa de arquitetura, lógica, bugs e organização**  
> Analisados ~50 arquivos de código fonte em `packages/shared`, `apps/server` e `apps/client`.

---

## Veredicto Geral

O projeto está **surpreendentemente bem estruturado para um projeto pessoal**. A separação em monorepo (workspaces), o uso de camadas no server (domain → application → infrastructure), o protocolo tipado no `shared`, a validação com Zod, e a preload bridge segura com `contextIsolation` são decisões acertadas. Mas há **bugs reais**, **inconsistências lógicas** e **gargalos de escalabilidade** que merecem atenção.

---

## 🔴 Bugs e Erros Crassos (Gravidade Alta)

### 1. `saveToDisk()` falha no fechamento da janela — Database corruption

| Item | Detalhe |
|---|---|
| **Onde está** | [SqliteWrapper.ts](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/server/src/infrastructure/database/SqliteWrapper.ts#L47-L58), log da saída: `Error persisting sqlite database to disk: N { name: 'ErrnoError', Pa: 44 }` |
| **Qual é o problema** | O sql.js roda in-memory e faz `fs.writeFileSync()` para persistir. No shutdown do Electron, o server `stop()` é chamado **duas vezes** (uma pelo evento `window-all-closed` e outra pelo `before-quit` no [main.ts](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/client/src/main/main.ts#L61-L70)). Depois do primeiro `close()`, o db já foi liberado, e a segunda tentativa de `saveToDisk` opera num fs já fechado/detached, gerando `ErrnoError 44` (ENODATA). **Mensagens enviadas nos últimos instantes podem ser perdidas.** |
| **Como resolver** | Adicionar uma flag `isClosed` no `SqlJsDriver` para evitar operações após o primeiro `close()`. No `main.ts`, usar uma flag `isShuttingDown` para garantir que `serverManager.stopServer()` seja chamado apenas uma vez. |

```diff
// SqliteWrapper.ts
+ private isClosed: boolean = false;

  public close(): void {
+   if (this.isClosed) return;
+   this.isClosed = true;
    this.saveToDisk();
    this.db.close();
  }

  private saveToDisk(): void {
+   if (this.isClosed) return;
    if (this.inTransaction > 0) return;
    // ...
  }
```

```diff
// main.ts
+ let isShuttingDown = false;

  app.on('window-all-closed', () => {
+   if (!isShuttingDown) {
+     isShuttingDown = true;
      serverManager.stopServer();
+   }
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
+   if (!isShuttingDown) {
+     isShuttingDown = true;
      serverManager.stopServer();
+   }
  });
```

---

### 2. `WAL mode` silenciosamente ignorado — sem benefit real

| Item | Detalhe |
|---|---|
| **Onde está** | [DatabaseConnection.ts](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/server/src/infrastructure/database/DatabaseConnection.ts#L15-L16) → `driver.pragma('journal_mode = WAL')` |
| **Qual é o problema** | O `pragma()` no [SqliteWrapper.ts L149-154](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/server/src/infrastructure/database/SqliteWrapper.ts#L149-L154) tem um `try/catch` silencioso. O sql.js (WASM) **não suporta WAL mode** porque opera in-memory. O pragma é ignorado silenciosamente, mas o código dá a falsa impressão de que está ativo. Da mesma forma, `foreign_keys = ON` pode ou não estar ativo dependendo da versão do sql.js. |
| **Como resolver** | Remover o pragma `WAL` (é enganoso) e documentar que sql.js opera in-memory com flush manual. Se quiser WAL real, migrar para `better-sqlite3` (nativo, não WASM). |

---

### 3. Race condition na reconexão do NetworkClient

| Item | Detalhe |
|---|---|
| **Onde está** | [NetworkClient.ts L198-222](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/client/src/renderer/core/NetworkClient.ts#L198-L222) |
| **Qual é o problema** | `scheduleReconnect()` chama `this.connect()` recursivamente, que por sua vez chama `this.clearReconnect()` e reseta `reconnectAttempt = 0`. Isso significa que **o backoff exponencial é resetado a cada tentativa**, porque `connect()` sempre faz `this.reconnectAttempt = 0`. O resultado é que o delay nunca passa de 1 segundo, gerando retries agressivos contra um servidor potencialmente offline. |
| **Como resolver** | Não resetar `reconnectAttempt` dentro de `connect()` quando chamado por reconexão. Criar um método separado `reconnectConnect()` ou passar uma flag. |

```diff
// NetworkClient.ts - connect()
  public async connect(
    host, port, clientId, nickname, password?,
+   isReconnect = false
  ): Promise<AuthSuccessPayload> {
-   this.reconnectAttempt = 0;
+   if (!isReconnect) {
+     this.reconnectAttempt = 0;
+   }
```

---

### 4. Nickname UNIQUE constraint conflict no banco vs validação online-only

| Item | Detalhe |
|---|---|
| **Onde está** | [001_initial.sql L13](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/server/src/infrastructure/database/migrations/001_initial.sql#L13): `nickname TEXT NOT NULL UNIQUE COLLATE NOCASE` vs [AuthService.ts L78-91](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/server/src/application/services/AuthService.ts#L78-L91) |
| **Qual é o problema** | A tabela `users` tem `UNIQUE` no `nickname`, mas a lógica de autenticação verifica unicidade **apenas entre usuários online**. Se um usuário "Murilo" se desconecta e outro "murilo" tenta se conectar com um `clientId` diferente, o `INSERT` no banco vai **crashar com UNIQUE constraint violation** — um erro não tratado que se propaga como `INTERNAL_ERROR` genérico. |
| **Como resolver** | Remover a constraint `UNIQUE` do nickname na tabela `users` (já que a validação é feita em tempo real pela app), ou então atualizar o nickname do registro existente ao invés de criar um novo. Na prática, o sistema já identifica o user pelo `clientId`, então o UNIQUE no nickname é incorreto. |

```sql
-- Nova migration: 002_fix_nickname_constraint.sql
DROP INDEX IF EXISTS idx_users_nickname;
-- Recriar tabela sem UNIQUE no nickname, ou em SQLite:
-- Não é possível ALTER TABLE para remover constraint, precisa recriar
```

---

### 5. `updateServer()` sem WHERE clause — atualiza TODAS as rows

| Item | Detalhe |
|---|---|
| **Onde está** | [SqliteRepositories.ts L19-29](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/server/src/infrastructure/database/SqliteRepositories.ts#L19-L29) |
| **Qual é o problema** | Os UPDATEs fazem `UPDATE server_meta SET name = ?` **sem WHERE clause**. Embora hoje só exista 1 row em `server_meta`, se por qualquer motivo houver mais de uma, todas serão afetadas. Além disso, são feitos em chamadas separadas (uma para `name`, outra para `passwordHash`, outra para `maxUsers`), cada uma causando um `saveToDisk()` separado — 3 writes desnecessários ao disco. |
| **Como resolver** | Adicionar `WHERE id = ?` (ou `LIMIT 1`), e consolidar os 3 UPDATEs em uma única query. |

```typescript
async updateServer(server: Partial<ServerRecord>): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  
  if (server.name !== undefined) { fields.push('name = ?'); values.push(server.name); }
  if (server.passwordHash !== undefined) { fields.push('password_hash = ?'); values.push(server.passwordHash); }
  if (server.maxUsers !== undefined) { fields.push('max_users = ?'); values.push(server.maxUsers); }
  
  if (fields.length === 0) return;
  this.db.prepare(`UPDATE server_meta SET ${fields.join(', ')} LIMIT 1`).run(...values);
}
```

---

## 🟠 Falta de Lógica e Inconsistências (Gravidade Média)

### 6. Avatar enviado como Data URL via WebSocket — massacre de bandwidth

| Item | Detalhe |
|---|---|
| **Onde está** | [UserService.ts L71-124](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/server/src/application/services/UserService.ts#L71-L124), [AvatarStorageService.ts L100-113](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/server/src/infrastructure/security/AvatarStorageService.ts#L100-L113) |
| **Qual é o problema** | Quando um user atualiza o avatar, o servidor lê o arquivo do disco, converte para base64 data URL, e o coloca dentro do `UserSummary` que é **broadcasted para todos os clientes via WebSocket**. Para um avatar de 1 MB, isso se torna ~1.33 MB em base64, multiplicado por N clientes. Com 10 pessoas online e avatares de 1 MB, uma atualização de avatar causa **~13 MB de tráfego instantâneo**. Todo `UserSummary` carrega o avatar completo: login, troca de nick, cada mensagem de chat — tudo inclui a data URL inteira. |
| **Como resolver** | Servir avatares via HTTP (o server HTTP já existe em [server.ts L91-99](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/server/src/server.ts#L91-L99)). Retornar apenas uma URL relativa (ex: `/avatars/uuid.jpg`) e os clientes buscam por HTTP request. Isso reduz o payload do WebSocket drasticamente. |

---

### 7. `chatStore` cresce infinitamente sem limite

| Item | Detalhe |
|---|---|
| **Onde está** | [chatStore.ts L13-20](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/client/src/renderer/stores/chatStore.ts#L13-L20) |
| **Qual é o problema** | `addMessage()` faz `list.push(message)` sem nenhum limite. Em uma sessão longa, o array de mensagens cresce indefinidamente na memória do renderer, especialmente porque cada `ChatMessage` inclui o avatar base64 completo do user. 1000 mensagens × 100 KB de avatar por mensagem = **~100 MB de memória consumida pelo chat**. |
| **Como resolver** | Implementar um limite circular (ex: manter apenas as últimas 500 mensagens por canal) e permitir "load more" via scroll. |

---

### 8. `RateLimiter` nunca é "cleaned up" — memory leak lento

| Item | Detalhe |
|---|---|
| **Onde está** | [RateLimiter.ts](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/server/src/infrastructure/security/RateLimiter.ts) |
| **Qual é o problema** | O método `cleanup()` existe mas **nunca é chamado por ninguém**. O Map `userMessageTimestamps` acumula entradas para cada userId que já enviou mensagem, para sempre. Cada entrada é limpa com window sliding no `checkLimit()`, mas a key do Map em si nunca é removida se o user para de enviar mensagens. |
| **Como resolver** | Registrar um `setInterval` no constructor ou no server para chamar `cleanup()` periodicamente (ex: a cada 60s). |

---

### 9. Canais deletados não desconectam usuários de voz

| Item | Detalhe |
|---|---|
| **Onde está** | [ChannelService.ts L83-97](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/server/src/application/services/ChannelService.ts#L83-L97), [WebSocketServer.ts L307-329](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/server/src/infrastructure/websocket/WebSocketServer.ts#L307-L329) |
| **Qual é o problema** | Quando um canal de voz é deletado, o server apenas faz `DELETE` no banco e broadcasteia `CHANNEL_DELETED`. Mas **não remove os voice states dos participantes** que estavam naquele canal via `SignalingService`, nem notifica os peers WebRTC para se desconectarem. Os usuários ficam em um "canal fantasma". |
| **Como resolver** | No `handleChannelDelete`, antes de deletar, verificar se é um canal VOICE, e se for, remover todos os voice states daquele canal e broadcastear `VOICE_USER_LEFT` para cada participante. |

---

### 10. `MessageType` como string literal bypass na ConnectionView

| Item | Detalhe |
|---|---|
| **Onde está** | [ConnectionView.ts L298](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/client/src/renderer/views/ConnectionView.ts#L298): `'USER_UPDATE_AVATAR' as any` |
| **Qual é o problema** | O type system é completamente bypassado com `as any`. Se o nome do MessageType mudar, isso silenciosamente para de funcionar. Aparece 2x no arquivo (linhas 298 e 364). |
| **Como resolver** | Usar `MessageType.USER_UPDATE_AVATAR` diretamente (já existe no enum). |

---

### 11. `loadHistory()` busca **todos os users** do banco para cada request

| Item | Detalhe |
|---|---|
| **Onde está** | [ChatService.ts L94-116](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/server/src/application/services/ChatService.ts#L94-L116): `const users = await this.userRepo.listAll()` |
| **Qual é o problema** | Toda vez que alguém pede histórico de chat, o server faz um `SELECT *` em toda a tabela de users para montar o `userMap`. Com muitos users históricos, isso fica progressivamente mais lento. |
| **Como resolver** | Usar um JOIN na query SQL ao invés de 2 queries separadas, ou no mínimo, buscar apenas os users que aparecem nas mensagens retornadas. |

---

## 🟡 Bagunça e Desorganização (Gravidade Baixa-Média)

### 12. `escapeHtml()` duplicado em 3 Views

| Item | Detalhe |
|---|---|
| **Onde está** | [MainView.ts L411-418](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/client/src/renderer/views/MainView.ts#L411-L418), [ConnectionView.ts L403-409](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/client/src/renderer/views/ConnectionView.ts#L403-L409), e provavelmente em ChatView e outras views. |
| **Qual é o problema** | Código duplicado — a mesma função copiada e colada em múltiplas classes. |
| **Como resolver** | Extrair para `utils/html.ts` e importar em todas as views. |

---

### 13. `test-server.ts` no source do server — não é teste real

| Item | Detalhe |
|---|---|
| **Onde está** | [test-server.ts](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/server/src/test-server.ts) |
| **Qual é o problema** | O arquivo está no `src/` do server, não no diretório `test/`. É um script de teste manual, não usa nenhum framework de teste, e não é referenciado pelo `npm test`. Além disso, não tem timeout — se um teste travar, fica esperando para sempre. |
| **Como resolver** | Mover para `apps/server/test/`, converter para um framework como vitest/jest, ou pelo menos adicionar timeouts nas Promises. |

---

### 14. `AuthService.updateServerSettings()` usa tipo errado

| Item | Detalhe |
|---|---|
| **Onde está** | [AuthService.ts L175](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/server/src/application/services/AuthService.ts#L175): `Partial<UserRecord & { name?: string; passwordHash?: string }>` |
| **Qual é o problema** | O tipo `updates` inclui `UserRecord` quando deveria ser `ServerRecord`. Funciona por coincidência (ambos têm campos em comum), mas é semanticamente errado e confuso. Na linha 189, faz `as any` para contornar isso. |
| **Como resolver** | Usar `Partial<ServerRecord>` diretamente. |

---

### 15. Repositories são `async` mas nada é realmente assíncrono

| Item | Detalhe |
|---|---|
| **Onde está** | Todo o [SqliteRepositories.ts](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/server/src/infrastructure/database/SqliteRepositories.ts) |
| **Qual é o problema** | Todos os métodos são `async` e retornam `Promise<T>`, mas as operações do sql.js são **100% síncronas** (`prepare().get()`, `.run()`, `.all()`). Não há nenhum `await` dentro desses métodos. Isso adiciona overhead desnecessário de micro-tasks para cada operação de banco. |
| **Como resolver** | Isso na verdade é uma **decisão de design aceitável** — as interfaces de repositório são async para permitir futura migração para um driver assíncrono (ex: better-sqlite3 com worker threads, ou PostgreSQL). Não é urgente mudar, mas vale documentar o motivo. |

---

## 🟢 Gargalos de Desempenho e Escalabilidade

### 16. `saveToDisk()` chamado a cada INSERT/UPDATE — I/O excessivo

| Item | Detalhe |
|---|---|
| **Onde está** | [SqliteWrapper.ts L96-111](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/server/src/infrastructure/database/SqliteWrapper.ts#L96-L111) |
| **Qual é o problema** | Cada `run()` chama `saveToDisk()`, que faz `db.export()` (copia todo o banco in-memory para buffer) + `fs.writeFileSync()`. Para 1000 mensagens de chat, são 1000 writes síncronos completos do banco inteiro. Em um banco de 10 MB, isso são **10 GB de I/O total** para 1000 mensagens. |
| **Como resolver** | Implementar debounce no `saveToDisk()` — acumular writes e salvar a cada N segundos (ex: 5s), ou após N operações. Manter um `isDirty` flag. |

```typescript
private saveDirty: boolean = false;
private saveTimer: any = null;

private markDirty(): void {
  if (this.isClosed) return;
  this.saveDirty = true;
  if (!this.saveTimer) {
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.saveDirty) this.flushToDisk();
    }, 3000);
  }
}
```

---

### 17. Topologia Mesh WebRTC não escala

| Item | Detalhe |
|---|---|
| **Onde está** | [WebRtcManager.ts](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/client/src/renderer/core/WebRtcManager.ts) — toda a classe |
| **Qual é o problema** | Cada peer conecta com **todos** os outros peers diretamente (full mesh). Com N participantes em um canal de voz, cada user mantém N-1 conexões. O tráfego total sobe como O(N²). Com 5 pessoas, são 20 conexões P2P totais; com 10 pessoas, 90 conexões. A CPU de encoding e o upload explodem. |
| **Como resolver** | Para o contexto do projeto (amigos, max ~10 pessoas), isso é aceitável e funcional. Para escalar além, seria necessário implementar um SFU (Selective Forwarding Unit). Mas dado que `MAX_PARTICIPANTS_PER_CHANNEL_DEFAULT = 10`, o mesh é uma decisão válida para o escopo. Apenas documente o limite e considere alertar o user se muitos peers estiverem no canal. |

---

### 18. `participants.updated` emitido excessivamente

| Item | Detalhe |
|---|---|
| **Onde está** | [ParticipantManager.ts](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/client/src/renderer/core/ParticipantManager.ts) — quase todo método emite `participants.updated` |
| **Qual é o problema** | `addUser`, `removeUser`, `updateVoiceState`, `removeVoiceState`, `setRemoteStream`, `clear` — todos emitem `participants.updated`. Na `MainView`, este evento causa `renderChannels()` + `renderMembers()`, o que recria todo o DOM dos sidebars. Durante o join de um voice channel, isso pode causar **múltiplos re-renders seguidos** (voice state update + stream update + speaking change). |
| **Como resolver** | Implementar um debounce/coalesce para o evento, ou usar `requestAnimationFrame` para agrupar renders no próximo frame. |

---

## ✅ O que está BOM

| Aspecto | Nota |
|---|---|
| **Monorepo com workspaces** | Boa separação `shared`, `server`, `client`. Facilita manutenção. |
| **Protocolo tipado com enum** | `MessageType`, `ProtocolErrorCode`, payloads tipados no `shared` — excelente para manter client/server sincronizados. |
| **Validação com Zod** | `validators.ts` centraliza validação de nickname, message, channel — previne dados malformados. |
| **preload.ts com contextBridge** | `contextIsolation: true` + `nodeIntegration: false` — configuração segura do Electron. |
| **Implementação do Perfect Negotiation WebRTC** | O padrão polite/impolite peer com collision detection em [WebRtcManager.ts](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/client/src/renderer/core/WebRtcManager.ts#L234-L328) é a implementação correta da spec W3C. |
| **VAD (Voice Activity Detection)** | Detecção de voz por frequência + histerese de silêncio é uma abordagem sólida. |
| **Domain layer no server** | Interfaces de repository + entities separadas — Clean Architecture light que funciona bem para o escopo. |
| **Reconnect com backoff exponencial** | `RECONNECT_DELAYS_MS = [1, 2, 4, 8, 16, 30s]` — pattern correto (apesar do bug #3). |
| **Magic bytes validation para avatares** | Checagem de PNG/JPEG/WebP por bytes reais em vez de confiar no `Content-Type` — sólido. |
| **Password hashing com scrypt + timingSafeEqual** | Apesar de ser "entre amigos", o [PasswordService.ts](file:///c:/Users/muril/Documents/MeusProjetos/NovoDiscord/apps/server/src/infrastructure/security/PasswordService.ts) é profissionalmente implementado. |

---

## 📊 Resumo por Prioridade

| Prioridade | # | Problema |
|---|---|---|
| 🔴 **Crítico** | 1 | Double-stop causa erro no DB ao fechar |
| 🔴 **Crítico** | 3 | Backoff exponencial resetado na reconexão |
| 🔴 **Crítico** | 4 | UNIQUE constraint no nickname vai crashar |
| 🟠 **Alto** | 5 | UPDATE sem WHERE em `server_meta` |
| 🟠 **Alto** | 6 | Avatar base64 broadcasted via WebSocket |
| 🟠 **Alto** | 9 | Deleção de canal não limpa voice states |
| 🟠 **Alto** | 16 | `saveToDisk()` a cada operação — I/O brutal |
| 🟡 **Médio** | 7 | ChatStore cresce infinitamente |
| 🟡 **Médio** | 8 | RateLimiter nunca limpo |
| 🟡 **Médio** | 11 | `listAll()` em cada load de histórico |
| 🟡 **Médio** | 18 | Re-renders excessivos do DOM |
| 🟢 **Baixo** | 2, 10, 12, 13, 14, 15 | WAL fake, `as any`, duplicação, etc. |
