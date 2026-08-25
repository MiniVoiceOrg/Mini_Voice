# Idiomas (i18n)

Todo texto que o usuário vê sai daqui. Nenhuma view deve conter frase escrita
direto no HTML — sempre `t('chave')`.

## Como usar no código

```ts
import { t, tCount } from '../i18n';

t('common.cancel');                              // texto simples
t('connection.lastStarted', { date: '01/01' });  // {date} vira o valor passado
tCount('soundboard.soundCount', sounds.length);  // escolhe .one ou .other
```

Erros que chegam do servidor têm código próprio e são traduzidos por
`translateProtocolError(code, mensagemDoServidor)` — o texto em português que o
servidor manda só aparece se o código for desconhecido (cliente antigo com
servidor novo).

Diálogos nativos (abrir arquivo/pasta) são criados pelo processo main, que tem
um catálogo próprio e menor em `apps/client/src/main/i18n.ts`. O renderer avisa
o main sempre que o idioma muda.

## Como adicionar um novo idioma

1. Copie `locales/pt-BR.ts` para `locales/<código>.ts` (ex.: `es.ts`), troque o
   nome da constante e traduza os valores. **Não mude as chaves.**
2. Em `index.ts`, importe o arquivo, adicione o código em `SupportedLanguage`,
   registre o par em `CATALOGS` e inclua uma entrada em `SUPPORTED_LANGUAGES`
   com o nome do idioma escrito nele mesmo (ex.: `Español`).
3. Se quiser os diálogos nativos traduzidos, repita o passo no catálogo do main
   (`apps/client/src/main/i18n.ts`).
4. `npm run build` — o TypeScript acusa qualquer chave faltando, porque
   `TranslationMap` é derivado de `pt-BR.ts`.

O seletor em **Configurações › Idioma** é montado a partir de
`SUPPORTED_LANGUAGES`, então o idioma novo aparece sozinho.

## Regras

- `pt-BR.ts` é a fonte da verdade das chaves; chave nova nasce lá.
- Chave faltando em outro idioma cai no texto em português em vez de sumir da
  tela — mas o build já reclama antes disso acontecer.
- Sem escolha manual, o app segue o idioma do sistema
  (`detectSystemLanguage()`); a escolha do usuário fica em `localStorage`.
- Trocar o idioma emite `i18n.language_changed`; quem desenha tela escuta esse
  evento e re-renderiza.
