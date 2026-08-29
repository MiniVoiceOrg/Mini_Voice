# Checklist Arquitetural e de Qualidade de Código (Monky)

Este documento compila as diretrizes técnicas do [AGENTS.md](../../../../AGENTS.md) e as práticas recomendadas de Code Review do projeto Monky.

---

## 1. 🛡️ Electron, IPC & Segurança

- [ ] **Isolamento de Contexto:** `contextIsolation: true` e `nodeIntegration: false` em todas as janelas do Electron.
- [ ] **Preload Seguro:** Nenhuma API sensível do Node.js/Electron exposta sem sanitização.
- [ ] **Tipagem Centralizada de IPC:** Todas as mensagens de IPC devem utilizar as interfaces tipadas em `packages/shared/src/ipc.ts`.
- [ ] **Prevenção de Memory Leaks no IPC:** Handlers IPC não devem ser registrados em duplicidade nem reter referências de janelas fechadas.
- [ ] **Sanitização no Main Process:** Validação estrita de qualquer entrada vinda do Renderer antes de executar operações de I/O, rede, arquivos ou navegação externa (`shell.openExternal`).

---

## 2. 🎙️ WebRTC & Processamento de Áudio/Vídeo

- [ ] **Ciclo de Vida do WebRTC:** Teardown explícito de `RTCPeerConnection` (`peer.close()`) e limpeza de DataChannels ao desconectar.
- [ ] **Parada de Trilhas de Mídia:** Chamada explícita de `MediaStreamTrack.stop()` ao mutar microfone, desligar webcam ou encerrar compartilhamento de tela.
- [ ] **Web Audio API Cleanup:** Fechamento e desconexão de instâncias de `AudioContext`, `MediaStreamAudioSourceNode`, `GainNode` e `AudioWorkletNode`.
- [ ] **Concorrência e Sinalização:** Tratamento adequado de condições de corrida em ofertas/respostas SDP e candidatos ICE.

---

## 3. ⚙️ Módulos Nativos C++ / Node-API (`@monky/screen-audio`)

- [ ] **Memory Safety:** Liberação correta de buffers de áudio e recursos do sistema operacional (WASAPI / CoreAudio).
- [ ] **Thread Safety:** Utilização de `napi_threadsafe_function` para despachar callbacks para o Event Loop do Node.js.
- [ ] **Resiliência a Falhas:** Isole erros de captura de áudio com `try/catch` e códigos de retorno para evitar que falhas de dispositivo causem crash no processo Main.

---

## 4. 🖥️ Renderer Vanilla TypeScript & DOM

- [ ] **Limpeza de Event Listeners:** Remoção de listeners vinculados a `window`, `document`, elementos do DOM ou ao `EventBus` quando uma view ou modal for desmontado.
- [ ] **Gerenciamento de Estado Previsível:** Estados concentrados nas Stores dedicadas (`chatStore`, `voiceStore`, `serverStore`, `settingsStore`, `connectionStore`).
- [ ] **Performance de Renderização:** Evitar reflows/repaints desnecessários; preferir mutações cirúrgicas do DOM em vez de substituição massiva de `innerHTML`.

---

## 5. 🗄️ Backend / Servidor (Clean Architecture)

- [ ] **Separação de Camadas:** Divisão estrita entre `domain` (regras puras), `application` (casos de uso) e `infrastructure` (SQLite, WebSocket, rede).
- [ ] **Persistência Segura (SQLite):** Consultas parametrizadas (proteção contra SQL Injection) e transações para operações em lote.
- [ ] **WebSocket Resiliente:** Heartbeats (ping/pong) para identificar conexões zumbis e limpar recursos.

---

## 6. 📐 Rigor TypeScript & Protocol Versioning

- [ ] **Sem `any`:** Ausência de `any` ou asserções do tipo `as unknown as Type`.
- [ ] **Tratamento de Nulos:** Tipagem discriminada e validação explícita de `null` / `undefined`.
- [ ] **SemVer & Protocolo:** Mudanças no `PROTOCOL_VERSION` (`packages/shared/src/constants.ts`) ou formato de mensagens devem ser marcadas como `major` / `feat!:`.
