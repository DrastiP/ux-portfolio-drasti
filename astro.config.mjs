// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://DrastiP.github.io',
  base: '/ux-portfolio-drasti',
  vite: {
    plugins: [tailwindcss()],
  },
});
