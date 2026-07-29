import { build } from 'esbuild';
import { polyfillNode } from 'esbuild-plugin-polyfill-node';

await build({
  entryPoints: ['browser/wallet-pay.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'public/wallet-pay.mjs',
  platform: 'browser',
  target: 'es2022',
  plugins: [polyfillNode()],
  banner: {
    js: "import { Buffer } from 'buffer'; globalThis.Buffer = Buffer;",
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'info',
});
