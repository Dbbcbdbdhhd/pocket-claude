import { base32nopad, base64, base64urlnopad, hex } from '@scure/base';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const utf8 = (s: string): Uint8Array => encoder.encode(s);
export const fromUtf8 = (b: Uint8Array): string => decoder.decode(b);

export const b64 = {
  encode: (b: Uint8Array): string => base64.encode(b),
  decode: (s: string): Uint8Array => base64.decode(s),
};

export const b64url = {
  encode: (b: Uint8Array): string => base64urlnopad.encode(b),
  decode: (s: string): Uint8Array => base64urlnopad.decode(s),
};

export const b32 = {
  encode: (b: Uint8Array): string => base32nopad.encode(b),
  decode: (s: string): Uint8Array => base32nopad.decode(s.toUpperCase().replace(/[^A-Z2-7]/g, '')),
};

export const toHex = (b: Uint8Array): string => hex.encode(b);

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function groupChars(s: string, size = 4): string {
  return s.match(new RegExp(`.{1,${size}}`, 'g'))?.join('-') ?? s;
}
