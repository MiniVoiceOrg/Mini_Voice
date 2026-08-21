import { escapeHtml } from './html';

/**
 * Renders a small, safe subset of Markdown for chat messages.
 *
 * The input is HTML-escaped first, so user content can never inject markup;
 * formatting tokens are then translated into a fixed whitelist of tags. Only
 * http(s) links are allowed and they always open in the external browser via
 * the `data-external-link` hook wired up by the ChatView.
 *
 * Supported syntax:
 *   ```code block```      → <pre><code>
 *   `inline code`         → <code>
 *   **bold**              → <strong>
 *   *italic* / _italic_   → <em>
 *   ~~strike~~            → <del>
 *   [text](https://url)   → <a>
 *   bare https://url      → <a>
 *   newlines              → <br>
 */
export function renderMarkdown(raw: string): string {
  if (!raw) return '';

  // 1. Escape everything up-front — no raw HTML from users can survive this.
  let text = escapeHtml(raw);

  // 2. Fenced code blocks (```...```). Placeholder them out so inner content is
  //    not touched by the inline rules below.
  const codeBlocks: string[] = [];
  text = text.replace(/```([\s\S]*?)```/g, (_m, code) => {
    const idx = codeBlocks.push(`<pre class="md-codeblock"><code>${code.replace(/^\n/, '')}</code></pre>`) - 1;
    return `\u0000CB${idx}\u0000`;
  });

  // 3. Inline code (`...`). Same placeholder treatment.
  const inlineCodes: string[] = [];
  text = text.replace(/`([^`\n]+?)`/g, (_m, code) => {
    const idx = inlineCodes.push(`<code class="md-inline-code">${code}</code>`) - 1;
    return `\u0000IC${idx}\u0000`;
  });

  // 4. Links: [label](url) — only http/https.
  text = text.replace(/\[([^\]]+?)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, url) => {
    return `<a href="${url}" class="md-link" data-external-link="${url}">${label}</a>`;
  });

  // 5. Bare URLs (not already inside an anchor from step 4).
  text = text.replace(/(^|[\s])(https?:\/\/[^\s<]+)/g, (_m, pre, url) => {
    return `${pre}<a href="${url}" class="md-link" data-external-link="${url}">${url}</a>`;
  });

  // 6. Emphasis. Order matters: bold before italic.
  text = text.replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/~~([^\n]+?)~~/g, '<del>$1</del>');
  text = text.replace(/(^|[^\w*])\*([^\s*][^*\n]*?)\*(?![\w*])/g, '$1<em>$2</em>');
  text = text.replace(/(^|[^\w_])_([^\s_][^_\n]*?)_(?![\w_])/g, '$1<em>$2</em>');

  // 7. Newlines to <br> (outside code blocks, which were placeholdered out).
  text = text.replace(/\n/g, '<br>');

  // 8. Restore placeholders.
  text = text.replace(/\u0000IC(\d+)\u0000/g, (_m, i) => inlineCodes[Number(i)]);
  text = text.replace(/\u0000CB(\d+)\u0000/g, (_m, i) => codeBlocks[Number(i)]);

  return text;
}
