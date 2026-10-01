import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [cloudflare()],
  build: {
    chunkSizeWarningLimit: 1500,
  },
  environments: {
    client: {
      build: {
        rolldownOptions: {
          // admin.html wird unter /admin ausgeliefert
          input: { main: 'index.html', admin: 'admin.html' },
        },
      },
    },
  },
});
