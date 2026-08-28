import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import DownloadPanel from './components/DownloadPanel.vue';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('DownloadPanel', DownloadPanel);
  },
} satisfies Theme;
