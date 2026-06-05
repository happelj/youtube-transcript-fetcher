/// <reference lib="dom" />

declare const process: {
  env: Record<string, string | undefined>;
};

const cookieName = "ytf_openai_key";
const cookieMaxAgeSeconds = 60 * 60 * 24 * 180;
const encryptedValuePrefix = "v1";

type KeyStatusSource = "user" | "server" | "none";

export type OpenAiKeyStatus = {
  configured: boolean;
  source: KeyStatusSource;
  storageAvailable: boolean;
};

function getEncryptionSecret(): string | undefined {
  const secret =
    process.env.OPENAI_KEY_ENCRYPTION_SECRET ??
    process.env.OPENAI_KEY_SECRET;
  const trimmed = secret?.trim();
  return trimmed ? trimmed : undefined;
}

function getServerOpenAiKey(): string | undefined {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  return apiKey || undefined;
}

function parseCookieHeader(cookieHeader: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!cookieHeader) {
    return cookies;
  }

  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const name = cookie.slice(0, separator).trim();
    const value = cookie.slice(separator + 1).trim();
    if (name) {
      cookies.set(name, value);
    }
  }

  return cookies;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function getEncryptionKey(secret: string): Promise<CryptoKey> {
  const secretBytes = new TextEncoder().encode(secret);
  const keyHash = await crypto.subtle.digest("SHA-256", secretBytes);
  return crypto.subtle.importKey("raw", keyHash, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptApiKey(apiKey: string, secret: string): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const key = await getEncryptionKey(secret);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    new TextEncoder().encode(apiKey),
  );

  return [
    encryptedValuePrefix,
    bytesToBase64Url(iv),
    bytesToBase64Url(new Uint8Array(ciphertext)),
  ].join(".");
}

async function decryptApiKey(
  encryptedValue: string,
  secret: string,
): Promise<string | undefined> {
  const [prefix, ivValue, ciphertextValue] = encryptedValue.split(".");
  if (prefix !== encryptedValuePrefix || !ivValue || !ciphertextValue) {
    return undefined;
  }

  try {
    const key = await getEncryptionKey(secret);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytesToArrayBuffer(base64UrlToBytes(ivValue)),
      },
      key,
      bytesToArrayBuffer(base64UrlToBytes(ciphertextValue)),
    );

    return new TextDecoder().decode(plaintext);
  } catch {
    return undefined;
  }
}

function isSecureRequest(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  return new URL(request.url).protocol === "https:" || forwardedProto === "https";
}

function getCookieOptions(request: Request, maxAgeSeconds: number): string {
  const secure = isSecureRequest(request) ? "; Secure" : "";
  return `HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

export function isValidOpenAiApiKey(apiKey: string): boolean {
  return /^sk-[A-Za-z0-9_-]{20,}$/.test(apiKey.trim());
}

export async function createOpenAiKeyCookie(
  request: Request,
  apiKey: string,
): Promise<string> {
  const secret = getEncryptionSecret();
  if (!secret) {
    throw new Error("OPENAI_KEY_ENCRYPTION_SECRET is not configured.");
  }

  const encryptedValue = await encryptApiKey(apiKey.trim(), secret);
  return `${cookieName}=${encryptedValue}; ${getCookieOptions(
    request,
    cookieMaxAgeSeconds,
  )}`;
}

export function createDeleteOpenAiKeyCookie(request: Request): string {
  return `${cookieName}=; ${getCookieOptions(request, 0)}`;
}

export async function getStoredOpenAiApiKey(
  request: Request,
): Promise<string | undefined> {
  const encryptedValue = parseCookieHeader(request.headers.get("cookie")).get(cookieName);
  const secret = getEncryptionSecret();
  if (!encryptedValue || !secret) {
    return undefined;
  }

  const apiKey = await decryptApiKey(encryptedValue, secret);
  return apiKey && isValidOpenAiApiKey(apiKey) ? apiKey : undefined;
}

export async function getOpenAiApiKeyForRequest(
  request: Request,
): Promise<string | undefined> {
  return (await getStoredOpenAiApiKey(request)) ?? getServerOpenAiKey();
}

export async function getOpenAiKeyStatus(
  request: Request,
): Promise<OpenAiKeyStatus> {
  if (await getStoredOpenAiApiKey(request)) {
    return {
      configured: true,
      source: "user",
      storageAvailable: Boolean(getEncryptionSecret()),
    };
  }

  if (getServerOpenAiKey()) {
    return {
      configured: true,
      source: "server",
      storageAvailable: Boolean(getEncryptionSecret()),
    };
  }

  return {
    configured: false,
    source: "none",
    storageAvailable: Boolean(getEncryptionSecret()),
  };
}
