/**
 * Testes Unitários do Client (@monky/client)
 * Cobre utilitários de formatação, escape de HTML, parser de Markdown seguro,
 * ícones/tamanhos de anexos e o barramento de eventos (EventBus).
 */

import { escapeHtml } from '../src/renderer/utils/html';
import { renderMarkdown } from '../src/renderer/utils/markdown';
import { formatBytes, fileIconName } from '../src/renderer/utils/attachment';
import { EventBus } from '../src/renderer/core/EventBus';
import { normalizeSearchString, matchesSearch } from '../src/renderer/utils/search';
import { compareVersions, feedUrlForTag, isNewer, pickBestRelease } from '../src/main/updateVersions';
import { extractStickerIds, stickerToken, stripStickerTokens } from '../src/renderer/utils/stickers';
import { buildCodeMessage, indentEdit } from '../src/renderer/views/CodeBlockModal';
import { isSafeServerId, migrateLegacyServerData, serverDataDirFor } from '../src/main/serverDataDir';
import fs from 'fs';
import os from 'os';
import path from 'path';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✔ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FALHOU: ${message}`);
    failed++;
  }
}

function runTests() {
  console.log('=== Início dos Testes Unitários de @monky/client ===\n');

  // 1. escapeHtml
  console.log('--- Testando escapeHtml ---');
  assert(escapeHtml(null) === '', 'escapeHtml(null) retorna string vazia');
  assert(escapeHtml(undefined) === '', 'escapeHtml(undefined) retorna string vazia');
  assert(escapeHtml('') === '', 'escapeHtml("") retorna string vazia');
  assert(escapeHtml('Hello World') === 'Hello World', 'Texto simples sem caracteres especiais permanece idêntico');
  assert(
    escapeHtml('<script>alert("xss") & \'test\'</script>') ===
      '&lt;script&gt;alert(&quot;xss&quot;) &amp; &#039;test&#039;&lt;/script&gt;',
    'Caracteres perigosos (<, >, &, ", \') são escapados corretamente'
  );

  // 2. formatBytes
  console.log('\n--- Testando formatBytes ---');
  assert(formatBytes(0) === '0 B', '0 bytes retorna "0 B"');
  assert(formatBytes(-10) === '0 B', 'Bytes negativos retornam "0 B"');
  assert(formatBytes(500) === '500 B', '500 bytes retorna "500 B"');
  assert(formatBytes(1024) === '1 KB', '1024 bytes retorna "1 KB"');
  assert(formatBytes(1536) === '1.5 KB', '1536 bytes retorna "1.5 KB"');
  assert(formatBytes(1048576) === '1 MB', '1048576 bytes retorna "1 MB"');
  assert(formatBytes(5242880) === '5 MB', '5242880 bytes retorna "5 MB"');
  assert(formatBytes(1073741824) === '1 GB', '1073741824 bytes retorna "1 GB"');

  // 3. fileIconName
  console.log('\n--- Testando fileIconName ---');
  assert(fileIconName('image', 'image/png', 'foto.png') === 'image', 'Imagens retornam ícone "image"');
  assert(fileIconName('video', 'video/mp4', 'video.mp4') === 'movie', 'Vídeos retornam ícone "movie"');
  assert(fileIconName('file', 'audio/mpeg', 'audio.mp3') === 'audio_file', 'Áudios retornam ícone "audio_file"');
  assert(fileIconName('file', 'application/pdf', 'doc.pdf') === 'picture_as_pdf', 'PDFs retornam "picture_as_pdf"');
  assert(fileIconName('file', 'application/zip', 'archive.zip') === 'folder_zip', 'Arquivos compactados retornam "folder_zip"');
  assert(fileIconName('file', 'application/msword', 'doc.docx') === 'description', 'Documentos de texto retornam "description"');
  assert(fileIconName('file', 'text/csv', 'planilha.xlsx') === 'table_chart', 'Planilhas retornam "table_chart"');
  assert(fileIconName('file', 'text/plain', 'script.ts') === 'code', 'Arquivos de código retornam "code"');
  assert(fileIconName('file', 'application/octet-stream', 'desconhecido.bin') === 'draft', 'Arquivos desconhecidos retornam "draft"');

  // 4. renderMarkdown (Segurança & Formatação)
  console.log('\n--- Testando renderMarkdown ---');
  assert(renderMarkdown('') === '', 'String vazia retorna string vazia');

  // Prevenção contra injeção de HTML/XSS
  const xssTest = renderMarkdown('<img src=x onerror=alert(1)>');
  assert(!xssTest.includes('<img'), 'Tags HTML cruas não são interpretadas');
  assert(xssTest.includes('&lt;img'), 'Tags HTML cruas são escapadas');

  // Headers
  const h1Test = renderMarkdown('# Título 1');
  assert(h1Test.includes('<h1 class="md-h md-h1">Título 1</h1>'), 'Header H1 formatado');

  const h2Test = renderMarkdown('## Título 2');
  assert(h2Test.includes('<h2 class="md-h md-h2">Título 2</h2>'), 'Header H2 formatado');

  // Negrito e Itálico
  const boldTest = renderMarkdown('Texto **negrito** e *itálico*');
  assert(boldTest.includes('<strong>negrito</strong>'), 'Negrito formatado');
  assert(boldTest.includes('<em>itálico</em>'), 'Itálico formatado');

  // Strike-through
  const strikeTest = renderMarkdown('~~riscado~~');
  assert(strikeTest.includes('<del>riscado</del>'), 'Riscado formatado');

  // Código inline e bloco de código
  const codeTest = renderMarkdown('Use `npm install` no terminal');
  assert(codeTest.includes('<code class="md-inline-code">npm install</code>'), 'Código inline formatado');

  const blockCodeTest = renderMarkdown('```\nconsole.log("monky");\n```');
  assert(
    blockCodeTest.includes('<pre class="md-codeblock"><code class="hljs">console.log(&quot;monky&quot;);</code></pre>'),
    'Bloco de código formatado e escapado'
  );

  // Links seguros
  const linkTest = renderMarkdown('[Site Oficial](https://monky.chat)');
  assert(linkTest.includes('<a href="https://monky.chat" class="md-link" data-external-link="https://monky.chat">Site Oficial</a>'), 'Links Markdown formatados');

  const bareUrlTest = renderMarkdown('Visite https://monky.chat hoje');
  assert(bareUrlTest.includes('<a href="https://monky.chat" class="md-link" data-external-link="https://monky.chat">https://monky.chat</a>'), 'URLs soltas transformadas em link seguro');

  // Menções
  const mentionTest = renderMarkdown('Olá @Murilo!', { currentNickname: 'Murilo' });
  assert(mentionTest.includes('<span class="chat-mention chat-mention-me">@Murilo</span>'), 'Menção ao próprio usuário recebe classe destacada');

  const mentionOtherTest = renderMarkdown('Olá @Carlos!', { currentNickname: 'Murilo', knownNicknames: ['Carlos', 'Murilo'] });
  assert(mentionOtherTest.includes('<span class="chat-mention">@Carlos</span>'), 'Menção a outros usuários recebe classe de menção');

  // 5. EventBus
  console.log('\n--- Testando EventBus ---');
  const bus = new EventBus();
  let callCount = 0;
  let receivedData: any = null;

  const unsubscribe = bus.on('test.event', (data) => {
    callCount++;
    receivedData = data;
  });

  bus.emit('test.event', { foo: 'bar' });
  assert(callCount === 1, 'Listener executado uma vez no emit');
  assert(receivedData?.foo === 'bar', 'Payload transmitido corretamente');

  // Testando unsubscribe
  unsubscribe();
  bus.emit('test.event', { foo: 'baz' });
  assert(callCount === 1, 'Listener NÃO é executado após chamar unsubscribe');

  // Testando múltiplos listeners
  let l1 = 0;
  let l2 = 0;
  bus.on('multi.event', () => { l1++; });
  bus.on('multi.event', () => { l2++; });
  bus.emit('multi.event', null);
  assert(l1 === 1 && l2 === 1, 'Múltiplos listeners no mesmo evento são invocados');

  // 6. matchesSearch & normalizeSearchString (#288)
  console.log('\n--- Testando matchesSearch (#288) ---');
  assert(normalizeSearchString('Fáustão - Ô louco meu!') === 'faustao - o louco meu!', 'normalizeSearchString remove diacríticos e converte para minúsculas');
  assert(matchesSearch('Faustão - Ô louco meu', 'faustao'), 'matchesSearch encontra substring ignorando acento');
  assert(matchesSearch('Faustão - Ô louco meu', 'LOUCO'), 'matchesSearch é case-insensitive');
  assert(matchesSearch('Airhorn (Meme #1)', 'airhorn 1'), 'matchesSearch ignora caracteres especiais e pontuação');
  assert(matchesSearch('Galinha Pintadinha', 'pintadinha galinha'), 'matchesSearch combina múltiplos tokens fora de ordem');
  assert(matchesSearch('Som de Tambor', ''), 'Busca vazia retorna true');
  assert(!matchesSearch('Som de Tambor', 'buzina'), 'Busca não correspondente retorna false');

  // 7. SettingsStore Persistência (#325)
  console.log('\n--- Testando SettingsStore Persistência (#325) ---');
  const storageMap = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, val: string) => storageMap.set(key, String(val)),
    removeItem: (key: string) => storageMap.delete(key),
    clear: () => storageMap.clear(),
  };

  const { SettingsStore } = require('../src/renderer/stores/settingsStore');
  const store1 = new SettingsStore();

  // Define várias configurações incluindo atalhos, minimização e updates beta
  store1.minimizeToTrayOnClose = false;
  store1.updateBetaChannel = true;
  store1.askShutdownOnLastLeave = false;
  store1.soundboardVolume = 42;
  store1.soundboardMuted = true;
  store1.soundboardFolderPath = 'C:\\Sons';
  store1.soundboardShortcuts = {
    Airhorn: { accelerator: 'CommandOrControl+Alt+A', display: 'Ctrl + Alt + A' },
  };
  store1.keybindShortcuts = {
    toggle_mute: { accelerator: 'CommandOrControl+Shift+M', display: 'Ctrl + Shift + M' },
    toggle_deafen: { accelerator: 'CommandOrControl+Shift+D', display: 'Ctrl + Shift + D' },
  };
  store1.soundboardViewMode = 'list';
  store1.inputMode = 'push_to_talk';
  store1.pttKey = { code: 'Mouse4', display: 'Mouse 4 (Lateral Traseiro)', keyType: 'mouse', mouseButton: 4 };
  store1.pttReleaseDelay = 350;
  store1.pttSoundCue = false;
  store1.isMuted = true;
  store1.isDeafened = true;
  store1.chatMessageSoundEnabled = false;
  store1.chatMessageSoundMentionsOnly = true;
  store1.setServerChatSoundOverride('srv-1', 'none');
  store1.setChannelChatSoundOverride('chan-1', 'all');

  store1.save();

  assert(storageMap.has('monky_settings'), 'monky_settings foi salvo no localStorage');

  const rawJson = JSON.parse(storageMap.get('monky_settings')!);
  assert(rawJson.soundboardViewMode === 'list', 'soundboardViewMode serializado no JSON');
  assert(rawJson.inputMode === 'push_to_talk', 'inputMode serializado no JSON');
  assert(rawJson.pttKey?.code === 'Mouse4', 'pttKey serializado no JSON');
  assert(rawJson.pttReleaseDelay === 350, 'pttReleaseDelay serializado no JSON');
  assert(rawJson.pttSoundCue === false, 'pttSoundCue serializado no JSON');
  assert(rawJson.isMuted === true, 'isMuted serializado no JSON (#358)');
  assert(rawJson.isDeafened === true, 'isDeafened serializado no JSON (#358)');
  assert(rawJson.keybindShortcuts?.toggle_mute?.accelerator === 'CommandOrControl+Shift+M', 'keybindShortcuts serializado no JSON');
  assert(rawJson.soundboardShortcuts?.Airhorn?.accelerator === 'CommandOrControl+Alt+A', 'soundboardShortcuts serializado no JSON');
  assert(rawJson.minimizeToTrayOnClose === false, 'minimizeToTrayOnClose serializado no JSON');
  assert(rawJson.updateBetaChannel === true, 'updateBetaChannel serializado no JSON');

  // Cria uma nova instância para simular reabertura / reload da aplicação
  const store2 = new SettingsStore();
  assert(store2.soundboardViewMode === 'list', 'soundboardViewMode restaurado com sucesso');
  assert(store2.inputMode === 'push_to_talk', 'inputMode restaurado com sucesso');
  assert(store2.pttKey?.code === 'Mouse4' && store2.pttKey?.display === 'Mouse 4 (Lateral Traseiro)', 'pttKey restaurado com sucesso');
  assert(store2.pttReleaseDelay === 350, 'pttReleaseDelay restaurado com sucesso');
  assert(store2.pttSoundCue === false, 'pttSoundCue restaurado com sucesso');
  assert(store2.isMuted === true, 'isMuted restaurado com sucesso (#358)');
  assert(store2.isDeafened === true, 'isDeafened restaurado com sucesso (#358)');
  assert(store2.minimizeToTrayOnClose === false, 'minimizeToTrayOnClose restaurado com sucesso');
  assert(store2.updateBetaChannel === true, 'updateBetaChannel restaurado com sucesso');
  assert(store2.askShutdownOnLastLeave === false, 'askShutdownOnLastLeave restaurado com sucesso');
  assert(store2.soundboardVolume === 42, 'soundboardVolume restaurado com sucesso');
  assert(store2.soundboardMuted === true, 'soundboardMuted restaurado com sucesso');
  assert(store2.soundboardFolderPath === 'C:\\Sons', 'soundboardFolderPath restaurado com sucesso');
  assert(store2.soundboardShortcuts['Airhorn']?.display === 'Ctrl + Alt + A', 'soundboardShortcuts restaurado com sucesso');
  assert(store2.keybindShortcuts['toggle_mute']?.display === 'Ctrl + Shift + M', 'keybindShortcuts (toggle_mute) restaurado com sucesso');
  assert(store2.keybindShortcuts['toggle_deafen']?.display === 'Ctrl + Shift + D', 'keybindShortcuts (toggle_deafen) restaurado com sucesso');
  assert(store2.chatMessageSoundEnabled === false, 'chatMessageSoundEnabled restaurado com sucesso');
  assert(store2.chatMessageSoundMentionsOnly === true, 'chatMessageSoundMentionsOnly restaurado com sucesso');
  assert(store2.getServerChatSoundOverride('srv-1') === 'none', 'serverChatSoundOverride restaurado com sucesso');
  assert(store2.getChannelChatSoundOverride('chan-1') === 'all', 'channelChatSoundOverride restaurado com sucesso');

  // 8. VoiceStore Mute Persistence & Reset Resilience (#358)
  console.log('\n--- Testando VoiceStore Mute Universal (#358) ---');
  const { VoiceStore } = require('../src/renderer/stores/voiceStore');
  const voice = new VoiceStore();
  voice.setMuted(true);
  voice.setDeafened(true);
  assert(voice.isMuted === true, 'voiceStore.isMuted é true');
  assert(voice.isDeafened === true, 'voiceStore.isDeafened é true');
  assert(voice.getEffectiveMuted() === true, 'voiceStore.getEffectiveMuted() é true');

  // Ao chamar reset (ex: sair da sala, reconectar, mudar de servidor), o mute NÃO pode ser perdido
  voice.reset();
  assert(voice.isMuted === true, 'voiceStore.reset() NÃO desmuta o microfone do usuário (#358)');
  assert(voice.isDeafened === true, 'voiceStore.reset() NÃO desensurdece o áudio do usuário (#358)');
  assert(voice.getEffectiveMuted() === true, 'voiceStore.getEffectiveMuted() permanece true após reset');

  // Testa sanitização de valor inválido para soundboardViewMode e inputMode
  storageMap.set('monky_settings', JSON.stringify({
    soundboardViewMode: 'invalid_mode',
    inputMode: 'invalid_input_mode',
    pttReleaseDelay: -50,
    userVolumes: {
      'sess-1': 75,
      'sess-2': 150,
      'sess-3': -20,
    },
    screenAudioVolumes: {
      'sess-screen': 100,
    },
  }));
  const store3 = new SettingsStore();
  assert(store3.soundboardViewMode === 'grid', 'soundboardViewMode inválido é sanitizado para fallback "grid"');
  assert(store3.inputMode === 'voice_activity', 'inputMode inválido é sanitizado para fallback "voice_activity"');
  assert(store3.pttReleaseDelay === 0, 'pttReleaseDelay negativo é sanitizado para mínimo 0');
  assert(store3.getUserVolume('sess-1') === 75, 'Volume de usuário 75% lido corretamente');
  assert(store3.getUserVolume('sess-2') === 100, 'Volume de usuário > 100% clamped para 100%');
  assert(store3.getUserVolume('sess-3') === 0, 'Volume de usuário < 0% clamped para 0%');
  assert(store3.getScreenAudioVolume('sess-screen') === 100, 'Volume de screen audio 100% lido corretamente');

  store3.setUserVolume('sess-test', 80);
  assert(store3.getUserVolume('sess-test') === 80, 'setUserVolume aceita 80%');
  store3.setUserVolume('sess-test-overflow', 150);
  assert(store3.getUserVolume('sess-test-overflow') === 100, 'setUserVolume 150% é clamped para 100%');

  // --- Seleção de release do atualizador automático (#354) ---
  console.log('\n--- Testando seleção de release do atualizador ---');

  // Betas eram marcadas como vN.N.N-betaNNN, com zero à esquerda, para que a
  // página de releases (que ordena pelo nome da tag) as listasse na ordem certa
  // (#338). Hoje a tag traz só `-beta` (#382), mas a comparação precisa dar
  // conta dos dois formatos: quem está numa build numerada compara a versão
  // local antiga com a nova.
  assert(compareVersions('3.0.0', '3.0.0-beta007') > 0, 'Release estável supera a própria beta');
  assert(compareVersions('3.0.0', '3.0.0-beta') > 0, 'Release estável supera a beta sem contador');
  assert(compareVersions('3.0.0-beta010', '3.0.0-beta009') > 0, 'beta010 é mais nova que beta009');
  assert(compareVersions('3.1.0-beta', '3.0.0') > 0, 'Beta de uma minor futura supera a estável atual');
  assert(
    compareVersions('3.1.2-beta', '3.1.1-beta001') > 0,
    'Quem está numa beta numerada recebe a beta seguinte, já sem contador'
  );
  assert(isNewer('3.0.0', '3.0.0-beta007'), 'Quem está na beta007 recebe a 3.0.0 final');
  assert(!isNewer('3.0.0-beta007', '3.0.0'), 'Quem está na estável não é rebaixado para uma beta antiga');

  // O feed é a pasta de assets da própria release: latest.yml fica ao lado do
  // instalador que ele descreve. Apontar o electron-updater para cá evita que
  // ele procure a release sozinho, coisa que a busca dele faz mal porque aceita
  // a primeira do canal, ainda que mais antiga que a instalada (#354).
  assert(
    feedUrlForTag('v3.1.2-beta') ===
      'https://github.com/MonkyOrg/Monky/releases/download/v3.1.2-beta',
    'feedUrlForTag aponta para a pasta de assets da release'
  );
  assert(
    feedUrlForTag('v3.1.0-beta003') ===
      'https://github.com/MonkyOrg/Monky/releases/download/v3.1.0-beta003',
    'feedUrlForTag continua servindo as tags com contador'
  );

  // A listagem da API não vem em ordem cronológica: o GitHub ordena por nome da
  // tag, então a mais nova não é necessariamente a primeira.
  const releases = [
    { tag_name: 'v3.1.0-beta001' },
    { tag_name: 'v3.0.0' },
    { tag_name: 'v3.1.2-beta' },
    { tag_name: 'v3.1.0-beta002' },
  ];
  assert(pickBestRelease(releases)?.tag_name === 'v3.1.2-beta', 'pickBestRelease escolhe a maior versão, não a primeira da lista');
  assert(
    pickBestRelease([{ tag_name: 'v9.9.9', draft: true }, { tag_name: 'v3.0.0' }])?.tag_name === 'v3.0.0',
    'pickBestRelease ignora rascunhos'
  );
  assert(pickBestRelease([{ draft: false }])=== null, 'pickBestRelease ignora entradas sem tag');
  assert(pickBestRelease([]) === null, 'pickBestRelease devolve null para lista vazia');
  assert(pickBestRelease(null) === null, 'pickBestRelease devolve null quando a resposta não é uma lista');

  // --- Figurinhas do chat (#356) ---
  // O marcador viaja dentro do texto da mensagem, então precisa ser reconhecido
  // com precisão: se sobrar no conteúdo o usuário vê "[[sticker:...]]" cru, e se
  // for reconhecido demais uma mensagem comum some do feed.
  console.log('\n--- Figurinhas do chat (#356) ---');
  const stickerId = '2f1b8c4e-0a11-4a55-9c2d-7e6f0b3a91dd';
  assert(stickerToken(stickerId) === `[[sticker:${stickerId}]]`, 'stickerToken monta o marcador esperado');
  assert(
    extractStickerIds(stickerToken(stickerId))[0] === stickerId,
    'extractStickerIds recupera o id gerado por stickerToken'
  );
  assert(
    stripStickerTokens(stickerToken(stickerId), [stickerId]) === '',
    'stripStickerTokens deixa a mensagem vazia quando só há a figurinha'
  );
  assert(
    stripStickerTokens(`olha isso ${stickerToken(stickerId)}`, [stickerId]) === 'olha isso',
    'stripStickerTokens preserva o texto digitado pelo usuário'
  );
  // Um marcador que não corresponde a nenhum anexo tem que sobreviver como texto,
  // senão quem digitasse "[[sticker:teste]]" veria a própria mensagem sumir.
  assert(
    stripStickerTokens(`olha ${stickerToken('teste')} isso`, []) === `olha ${stickerToken('teste')} isso`,
    'marcador sem anexo correspondente permanece como texto literal'
  );
  assert(
    stripStickerTokens(`${stickerToken('aaa')}${stickerToken('bbb')}`, ['aaa']) === stickerToken('bbb'),
    'stripStickerTokens remove apenas os marcadores que viraram figurinha'
  );
  assert(
    extractStickerIds(`${stickerToken('aaa')} ${stickerToken('bbb')}`).join(',') === 'aaa,bbb',
    'extractStickerIds mantém a ordem de aparição'
  );
  assert(
    extractStickerIds(`${stickerToken('aaa')} ${stickerToken('aaa')}`).length === 1,
    'extractStickerIds não repete o mesmo anexo'
  );
  assert(extractStickerIds('mensagem normal').length === 0, 'texto comum não vira figurinha');
  assert(
    stripStickerTokens('mensagem normal', []) === 'mensagem normal',
    'stripStickerTokens não altera mensagens sem marcador'
  );
  assert(
    extractStickerIds('[[sticker:id com espaco]]').length === 0,
    'ids inválidos (com espaço) são ignorados'
  );
  assert(
    extractStickerIds(`[[sticker:${'a'.repeat(65)}]]`).length === 0,
    'ids absurdamente longos são ignorados'
  );
  // O escape de HTML acontece depois; o marcador não pode abrir caminho para injeção.
  assert(
    extractStickerIds('[[sticker:<img src=x onerror=alert(1)>]]').length === 0,
    'marcador com HTML dentro não é aceito'
  );

  console.log('\n--- Blocos de código do chat (#391) ---');

  const jsBlock = renderMarkdown('```js\nconst a = 1;\n```');
  assert(jsBlock.includes('class="hljs language-javascript"'), 'Alias "js" é normalizado para "javascript"');
  assert(jsBlock.includes('md-code-copy'), 'Bloco de código traz o botão de copiar');
  assert(jsBlock.includes('hljs-keyword'), 'Código com linguagem conhecida recebe realce');

  const unknownLang = renderMarkdown('```linguagemInventada\nfoo\n```');
  assert(
    unknownLang.includes('<code class="hljs">foo</code>'),
    'Linguagem desconhecida cai no bloco sem realce'
  );

  // O realce roda sobre o texto cru; nada pode escapar como HTML de verdade.
  // O hljs quebra a tag em spans, então o que se vê é `&lt;<span>script</span>&gt;`.
  const xssBlock = renderMarkdown('```html\n<script>alert(1)</script>\n```');
  assert(!xssBlock.includes('<script>'), 'Bloco de código não deixa passar <script> executável');
  assert(xssBlock.includes('&lt;'), 'Sinais de menor dentro do código viram entidade HTML');
  assert(!xssBlock.includes('&amp;lt;'), 'Bloco de código não escapa duas vezes');

  // Regressão: o comportamento anterior de fence numa linha só continua valendo.
  const singleLineFence = renderMarkdown('```trecho```');
  assert(
    singleLineFence.includes('<code class="hljs">trecho</code>'),
    'Fence de uma linha não confunde o conteúdo com a linguagem'
  );

  const codeMessage = buildCodeMessage('python', 'print("oi")');
  assert(codeMessage.startsWith('```python\n'), 'buildCodeMessage abre o fence com a linguagem');
  const roundTrip = renderMarkdown(codeMessage);
  assert(roundTrip.includes('language-python'), 'Mensagem gerada volta como bloco Python ao renderizar');

  // Fences dentro do código quebrariam o bloco ao meio se não fossem neutralizados.
  const nestedFence = renderMarkdown(buildCodeMessage('', 'antes\n```\ndepois'));
  assert(
    (nestedFence.match(/md-codeblock/g) || []).length === 1,
    'Fence digitado dentro do código não parte a mensagem em dois blocos'
  );

  console.log('\n--- Tab no campo de código (#391) ---');

  const tabAtCursor = indentEdit('const a', 7, 7, false);
  assert(
    tabAtCursor.text === '  ' && tabAtCursor.from === 7 && !tabAtCursor.reselect,
    'Tab no cursor insere dois espaços sem reposicionar a seleção'
  );

  // Sem tratar linha inteira, o Tab apagaria o trecho selecionado.
  const tabTwoLines = indentEdit('um\ndois', 0, 6, false);
  assert(tabTwoLines.text === '  um\n  dois', 'Tab com duas linhas selecionadas indenta as duas');
  assert(tabTwoLines.reselect, 'Bloco reindentado devolve a seleção às linhas afetadas');

  // A seleção começa no meio da primeira linha: a linha inteira ainda conta.
  const tabFromMiddle = indentEdit('um\ndois', 1, 5, false);
  assert(
    tabFromMiddle.from === 0 && tabFromMiddle.text === '  um\n  dois',
    'Indentação de bloco parte do início da linha, não do cursor'
  );

  const shiftTab = indentEdit('  um\n  dois', 0, 11, true);
  assert(shiftTab.text === 'um\ndois', 'Shift+Tab remove a indentação das linhas');

  const shiftTabTab = indentEdit('\tum', 0, 0, true);
  assert(shiftTabTab.text === 'um', 'Shift+Tab também remove indentação feita com tab');

  const shiftTabNoIndent = indentEdit('um', 0, 0, true);
  assert(shiftTabNoIndent.text === 'um', 'Shift+Tab em linha sem indentação não corta o texto');

  const roundTripIndent = indentEdit('a\nb', 0, 3, false);
  const backAgain = indentEdit(roundTripIndent.text, 0, roundTripIndent.text.length, true);
  assert(backAgain.text === 'a\nb', 'Indentar e desindentar devolve o texto original');

  // Dados dos servidores criados (#364)
  console.log('--- Testando pasta de dados por servidor ---');
  assert(isSafeServerId('created-1756400000000-a1b2c3'), 'Id gerado pelo app é aceito');
  assert(!isSafeServerId('..'), 'Id ".." é rejeitado');
  assert(!isSafeServerId('../../etc'), 'Id com travessia de caminho é rejeitado');
  assert(!isSafeServerId('pasta/servidor'), 'Id com barra é rejeitado');
  assert(!isSafeServerId(''), 'Id vazio é rejeitado');
  assert(
    serverDataDirFor('/base', 'created-1') === path.join('/base', 'created-1'),
    'Cada servidor recebe uma pasta própria dentro de server-data'
  );

  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monky-server-data-'));
  fs.writeFileSync(path.join(baseDir, 'server.db'), 'db-antigo');
  fs.mkdirSync(path.join(baseDir, 'avatars'));
  fs.writeFileSync(path.join(baseDir, 'avatars', 'a.png'), 'x');

  const firstDir = path.join(baseDir, 'created-1');
  assert(migrateLegacyServerData(baseDir, firstDir), 'Layout antigo é adotado pelo primeiro servidor que inicia');
  assert(
    fs.readFileSync(path.join(firstDir, 'server.db'), 'utf-8') === 'db-antigo',
    'O banco antigo é preservado, não descartado'
  );
  assert(fs.existsSync(path.join(firstDir, 'avatars', 'a.png')), 'Avatares acompanham o banco na migração');
  assert(!fs.existsSync(path.join(baseDir, 'server.db')), 'O banco solto some da raiz de server-data');

  const secondDir = path.join(baseDir, 'created-2');
  assert(
    !migrateLegacyServerData(baseDir, secondDir),
    'Um segundo servidor não herda nada: é essa herança que trazia o nome antigo de volta (#364)'
  );
  assert(!fs.existsSync(path.join(secondDir, 'server.db')), 'O segundo servidor nasce com a pasta vazia');

  fs.rmSync(baseDir, { recursive: true, force: true });

  console.log(`\n=== Relatório dos Testes ===`);
  console.log(`Total: ${passed + failed} | Passaram: ${passed} | Falharam: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
