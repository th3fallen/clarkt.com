// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://clarkt.com',
  integrations: [sitemap()],
  build: {
    inlineStylesheets: 'always',
  },
});
