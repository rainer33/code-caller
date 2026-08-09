import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'crypto';

export function generateApiKey(): string {
  return randomBytes(32).toString('hex');
}

export function generateSecret(): string {
  return randomBytes(32).toString('hex');
}

export function generateVerificationCode(): string {
  const value = randomBytes(3).readUIntBE(0, 3) % 1000000;
  return value.toString().padStart(6, '0');
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

export function encryptForRequestSecret(plainText: string, requestSecret: string) {
  const key = createHash('sha256').update(requestSecret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv(AES_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

export function decryptForRequestSecret(payload: {
  ciphertext: string;
  iv: string;
  authTag: string;
}, requestSecret: string) {
  const key = createHash('sha256').update(requestSecret).digest();
  const decipher = createDecipheriv(AES_ALGORITHM, key, Buffer.from(payload.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}
