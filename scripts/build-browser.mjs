import { build } from 'esbuild';
import { polyfillNode } from 'esbuild-plugin-polyfill-node';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const hederaSdkBrowser = path.resolve(root, '../node_modules/@hiero-ledger/sdk/lib/browser.js');

await build({
  entryPoints: ['browser/wallet-pay.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'public/wallet-pay.mjs',
  platform: 'browser',
  target: 'es2022',
  // Use @hiero-ledger/sdk browser build (WebClient) instead of Node/grpc client
  mainFields: ['browser', 'module', 'main'],
  alias: {
    '@hiero-ledger/sdk': hederaSdkBrowser,
  },
  plugins: [
    polyfillNode({
      globals: {
        buffer: true,
        process: true,
      },
    }),
  ],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'info',
});
