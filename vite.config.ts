import { defineConfig } from 'vite';

// Keep localhost development at /; builds and preview use the repository URL.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'serve' && !isPreview ? '/' : '/clb-calendar/',
}));
