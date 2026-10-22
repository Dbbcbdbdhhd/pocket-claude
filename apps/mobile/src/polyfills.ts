import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';

class Utf8Encoder {
  readonly encoding = 'utf-8';

  encode(input = ''): Uint8Array {
    const out: number[] = [];
    for (const ch of input) {
      const cp = ch.codePointAt(0) ?? 0xfffd;
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
      else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
    return Uint8Array.from(out);
  }
}

class Utf8Decoder {
  readonly encoding = 'utf-8';

  decode(input?: ArrayBuffer | ArrayBufferView): string {
    if (!input) return '';
    const b = ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
    let out = '';
    let i = 0;
    while (i < b.length) {
      const b0 = b[i++] as number;
      let cp = 0xfffd;
      if (b0 < 0x80) cp = b0;
      else if (b0 >= 0xc2 && b0 < 0xe0 && i < b.length) cp = ((b0 & 0x1f) << 6) | ((b[i++] as number) & 0x3f);
      else if (b0 >= 0xe0 && b0 < 0xf0 && i + 1 < b.length) cp = ((b0 & 0x0f) << 12) | (((b[i++] as number) & 0x3f) << 6) | ((b[i++] as number) & 0x3f);
      else if (b0 >= 0xf0 && b0 < 0xf5 && i + 2 < b.length) {
        cp = ((b0 & 0x07) << 18) | (((b[i++] as number) & 0x3f) << 12) | (((b[i++] as number) & 0x3f) << 6) | ((b[i++] as number) & 0x3f);
      }
      out += String.fromCodePoint(cp > 0x10ffff ? 0xfffd : cp);
    }
    return out;
  }
}

const g = globalThis as Record<string, unknown>;
if (typeof g.TextEncoder === 'undefined') g.TextEncoder = Utf8Encoder;
if (typeof g.TextDecoder === 'undefined') g.TextDecoder = Utf8Decoder;
