import { PinataSDK } from 'pinata';

export type FactPhoto = {
  cid: string;
  name: string;
  mimeType: string;
  url: string;
};

let pinataClient: PinataSDK | null = null;

export function isPinataConfigured() {
  return Boolean(process.env.PINATA_JWT?.trim());
}

function getPinataClient() {
  const jwt = process.env.PINATA_JWT?.trim();
  if (!jwt) {
    throw new Error('PINATA_JWT is not configured');
  }

  if (!pinataClient) {
    pinataClient = new PinataSDK({
      pinataJwt: jwt,
      pinataGateway: process.env.PINATA_GATEWAY?.trim() ?? '',
    });
  }

  return pinataClient;
}

export async function uploadFactPhoto(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  factId?: string,
): Promise<FactPhoto> {
  const pinata = getPinataClient();
  const file = new File([buffer], filename, { type: mimeType });
  const upload = await pinata.upload.public.file(file).keyvalues({
    app: 'newsfacts',
    ...(factId ? { factId } : {}),
  });

  let url = `https://gateway.pinata.cloud/ipfs/${upload.cid}`;
  try {
    url = await pinata.gateways.public.convert(upload.cid);
  } catch {
    // fallback gateway URL above
  }

  return {
    cid: upload.cid,
    name: upload.name ?? filename,
    mimeType: upload.mime_type ?? mimeType,
    url,
  };
}
