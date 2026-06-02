import { PrismaClient } from '@prisma/client';
import { createDecipheriv, createHash } from 'crypto';
import axios from 'axios';
import { gunzipSync } from 'zlib';

const prisma = new PrismaClient();

function decrypt(payload: string, secret: string): { cookie: string; cstk: string } {
  const key = createHash('sha256').update(secret).digest();
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}

async function main() {
  const secret = process.env.ENCRYPTION_KEY ?? 'dev-encryption-key-change-me';
  const account = await prisma.sourceAccount.findFirst({
    where: { userId: 'demo-user', provider: 'youdao' },
  });
  if (!account) {
    console.log('no account');
    return;
  }
  const { cookie, cstk } = decrypt(account.encryptedPayload, secret);

  const client = axios.create({
    baseURL: 'https://note.youdao.com',
    proxy: false,
    headers: { Cookie: cookie, Referer: 'https://note.youdao.com/web/' },
  });

  const rootRes = await client.post(
    `/yws/api/personal/file?method=getByPath&keyfrom=web&cstk=${cstk}`,
    new URLSearchParams({ path: '/', entire: 'true', purge: 'false', cstk }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  const rootId = rootRes.data?.fileEntry?.id;
  console.log('rootId', rootId);

  const listRes = await client.get(
    `/yws/api/personal/file/${rootId}?all=true&f=true&len=30&sort=1&isReverse=false&method=listPageByParentId&keyfrom=web&cstk=${cstk}`,
  );
  const entries = listRes.data?.entries ?? [];
  const first = entries.find((e: { fileEntry?: { dir?: boolean } }) => !e.fileEntry?.dir);
  const fileId = first?.fileEntry?.id;
  const name = first?.fileEntry?.name;
  console.log('first note', name, fileId);

  const dl = await client.post(
    `/yws/api/personal/sync?method=download&keyfrom=web&cstk=${cstk}`,
    new URLSearchParams({
      method: 'download',
      fileId,
      version: '-1',
      convert: 'true',
      editorType: '1',
      cstk,
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, responseType: 'arraybuffer' },
  );

  let raw = Buffer.from(dl.data);
  console.log('download bytes', raw.length, 'status', dl.status);
  if (raw[0] === 0x1f && raw[1] === 0x8b) {
    raw = gunzipSync(raw);
    console.log('gunzip bytes', raw.length);
  }
  console.log('head', raw.subarray(0, 80).toString('utf8'));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
