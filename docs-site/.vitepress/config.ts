import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

const ptSidebar = [
  {
    text: 'Guia',
    items: [
      { text: 'Início', link: '/' },
      { text: 'Instalação', link: '/instalacao' },
      { text: 'Primeiros Passos', link: '/primeiros-passos' },
    ],
  },
  {
    text: 'Uso',
    items: [
      { text: 'Criar Seu Servidor', link: '/criar-seu-servidor' },
      { text: 'Entrar Em Um Servidor', link: '/entrar-em-um-servidor' },
      { text: 'Usando o App', link: '/usando-o-app' },
      { text: 'Configurações', link: '/configuracoes' },
    ],
  },
  {
    text: 'Avançado',
    items: [
      { text: 'Hospedar em VPS', link: '/hospedar-em-vps' },
      { text: 'Monky CLI', link: '/cli' },
      { text: 'Monky Light', link: '/monky-light' },
      { text: 'Verificar Releases', link: '/verificar-releases' },
    ],
  },
  {
    text: 'Referência',
    items: [
      { text: 'Recursos', link: '/recursos' },
      { text: 'Arquitetura', link: '/arquitetura' },
      { text: 'Solução de Problemas', link: '/solucao-de-problemas' },
    ],
  },
];

const enSidebar = [
  {
    text: 'Guide',
    items: [
      { text: 'Home', link: '/en/' },
      { text: 'Installation', link: '/en/instalacao' },
      { text: 'Getting Started', link: '/en/primeiros-passos' },
    ],
  },
  {
    text: 'Usage',
    items: [
      { text: 'Create Your Server', link: '/en/criar-seu-servidor' },
      { text: 'Join a Server', link: '/en/entrar-em-um-servidor' },
      { text: 'Using the App', link: '/en/usando-o-app' },
      { text: 'Settings', link: '/en/configuracoes' },
    ],
  },
  {
    text: 'Advanced',
    items: [
      { text: 'Host on a VPS', link: '/en/hospedar-em-vps' },
      { text: 'Monky CLI', link: '/en/cli' },
      { text: 'Monky Light', link: '/en/monky-light' },
      { text: 'Verify Releases', link: '/en/verificar-releases' },
    ],
  },
  {
    text: 'Reference',
    items: [
      { text: 'Features', link: '/en/recursos' },
      { text: 'Architecture', link: '/en/arquitetura' },
      { text: 'Troubleshooting', link: '/en/solucao-de-problemas' },
    ],
  },
];

export default withMermaid(defineConfig({
  title: 'Monky',
  description: 'Voz, vídeo, tela e chat entre amigos — no seu próprio servidor.',
  base: '/Monky/',
  head: [['link', { rel: 'icon', href: '/Monky/logo.png' }]],

  locales: {
    root: {
      label: 'Português',
      lang: 'pt-BR',
      themeConfig: {
        sidebar: ptSidebar,
        nav: [
          { text: 'Guia', link: '/' },
          { text: 'Download', link: 'https://github.com/MonkyOrg/Monky/releases/latest' },
        ],
        outline: { label: 'Nesta página' },
        docFooter: { prev: 'Anterior', next: 'Próxima' },
        darkModeSwitchLabel: 'Tema',
        sidebarMenuLabel: 'Menu',
        returnToTopLabel: 'Voltar ao topo',
        langMenuLabel: 'Idioma',
        editLink: {
          pattern: 'https://github.com/MonkyOrg/Monky/edit/main/docs-site/:path',
          text: 'Editar esta página no GitHub',
        },
      },
    },
    en: {
      label: 'English',
      lang: 'en',
      description: 'Voice, video, screen sharing and chat with friends — on your own server.',
      themeConfig: {
        sidebar: enSidebar,
        nav: [
          { text: 'Guide', link: '/en/' },
          { text: 'Download', link: 'https://github.com/MonkyOrg/Monky/releases/latest' },
        ],
        editLink: {
          pattern: 'https://github.com/MonkyOrg/Monky/edit/main/docs-site/:path',
          text: 'Edit this page on GitHub',
        },
      },
    },
  },

  themeConfig: {
    logo: '/logo.png',
    socialLinks: [
      { icon: 'github', link: 'https://github.com/MonkyOrg/Monky' },
    ],
    search: {
      provider: 'local',
    },
  },
}));
