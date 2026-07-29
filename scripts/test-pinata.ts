/**
 * Live Pinata upload smoke test.
 */
import '../loadEnv.js';
import { isPinataConfigured, uploadFactPhoto } from '../pinataStore.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z5BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function main() {
  if (!isPinataConfigured()) {
    throw new Error('PINATA_JWT is not set');
  }

  const photo = await uploadFactPhoto(PNG_1X1, 'newsfacts-test.png', 'image/png', 'pinata-smoke');
  console.log('Pinata upload OK');
  console.log(JSON.stringify(photo, null, 2));
}

main().catch((error) => {
  console.error('Pinata test failed:', error);
  process.exit(1);
});
