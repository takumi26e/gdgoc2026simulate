import { fileURLToPath } from 'node:url';
import { defineConfig, type UserConfig } from 'vite';
import { loadCertificate, relay } from './server/relay.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 8443);

export default defineConfig(async (): Promise<UserConfig> => {
  const https = await loadCertificate(root);
  return {
    // /pc.html も /phone.html も index.html を返す（役割はパスで決める）
    appType: 'spa',
    server: { https, host: true, port, strictPort: true },
    preview: { https, host: true, port, strictPort: true },
    plugins: [relay(root)],
    build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  };
});
