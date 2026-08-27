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
  assert(blockCodeTest.includes('<pre class="md-codeblock"><code>console.log(&quot;monky&quot;);</code></pre>'), 'Bloco de código formatado e escapado');

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

  console.log(`\n=== Relatório dos Testes ===`);
  console.log(`Total: ${passed + failed} | Passaram: ${passed} | Falharam: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
