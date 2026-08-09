import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'crypto';

export function generateApiKey(): string {
  return randomBytes(32).toString('hex');
}

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

const AES_ALGORITHM = 'aes-256-gcm';

/** encryptSecret/decryptSecret store sensitive per-user values (e.g. push tokens) at rest, per NFR-1.4. */
export function encryptSecret(plainText: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv(AES_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, encrypted].map((buf) => buf.toString('hex')).join(':');
}

export function decryptSecret(cipherText: string, keyHex: string): string {
  const [ivHex, authTagHex, dataHex] = cipherText.split(':');
  const key = Buffer.from(keyHex, 'hex');
  const decipher = createDecipheriv(AES_ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}
