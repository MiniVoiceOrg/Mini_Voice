/**
 * Gera os SVGs da pagina de arquitetura a partir dos fontes mermaid em
 * `docs-site/diagramas/src/<lang>/*.mmd`.
 *
 * Rode `node docs-site/diagramas/scripts/gerar.mjs` depois de editar qualquer
 * `.mmd` e commite os SVGs junto. O mermaid-cli nao e dependencia do projeto:
 * ele e baixado sob demanda pelo `npx`, porque arrasta o Chromium do puppeteer
 * e so serve para regerar diagrama. Se voce ja tem o binario em algum lugar,
 * aponte `MMDC_BIN` para ele e o npx sai do caminho.
 *
 * Sao dois SVGs por diagrama, claro e escuro, trocados por CSS em
 * `.vitepress/theme/custom.css` conforme o tema da pagina.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temas = { claro: 'default', escuro: 'dark' };

/**
 * A fonte declarada e a mais larga da lista de proposito. O tamanho das caixas
 * e medido na maquina que gera, com a fonte que ela tem; se quem le o site
 * cair numa fonte mais estreita, o texto sobra espaco. O contrario cortaria.
 */
const fonte = '"DejaVu Sans", "Liberation Sans", Arial, Helvetica, sans-serif';

const config = (tema) => ({
  theme: tema,
  themeVariables: { fontSize: '16px', fontFamily: fonte },
  flowchart: { useMaxWidth: false, htmlLabels: true, nodeSpacing: 45, rankSpacing: 55, padding: 12 },
  sequence: { useMaxWidth: false },
});

const tmp = join(raiz, '.tmp');
mkdirSync(tmp, { recursive: true });
writeFileSync(join(tmp, 'puppeteer.json'), JSON.stringify({ args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] }));

let total = 0;
for (const lang of ['pt', 'en']) {
  const entrada = join(raiz, 'src', lang);
  const saida = join(raiz, lang);
  mkdirSync(saida, { recursive: true });

  for (const arquivo of readdirSync(entrada).filter((f) => f.endsWith('.mmd')).sort()) {
    const nome = arquivo.replace(/\.mmd$/, '');
    for (const [sufixo, tema] of Object.entries(temas)) {
      const cfg = join(tmp, `${tema}.json`);
      writeFileSync(cfg, JSON.stringify(config(tema)));
      const [bin, prefixo] = process.env.MMDC_BIN
        ? [process.env.MMDC_BIN, []]
        : ['npx', ['-y', '@mermaid-js/mermaid-cli@11.16.0']];
      execFileSync(bin, [...prefixo,
        '-i', join(entrada, arquivo),
        '-o', join(saida, `${nome}.${sufixo}.svg`),
        '-c', cfg,
        '-p', join(tmp, 'puppeteer.json'),
        '-b', 'transparent',
      ], { stdio: 'inherit' });
      total++;
    }
    console.log(`${lang}/${nome}`);
  }
}
rmSync(tmp, { recursive: true, force: true });
console.log(`\n${total} SVGs gerados.`);
