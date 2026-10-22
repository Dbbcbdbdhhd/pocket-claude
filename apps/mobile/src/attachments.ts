import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import type { ClipboardItem } from '@pocket/protocol';

/** A photo, a screenshot or a file about to be sent. Files carry a name; bare images are shown to Claude inline. */
export interface Attachment {
  key: string;
  mime: string;
  dataBase64: string;
  name?: string;
  /** Local preview for photos taken on the phone. */
  uri?: string;
}

export const MAX_ATTACHMENTS = 8;

/**
 * Total base64 budget for one message. The relay carries 32 MB per frame and the payload is
 * base64-encoded once more inside the encrypted envelope.
 */
export const MAX_ATTACHMENT_CHARS = 22_000_000;

const MIN_USEFUL_CHARS = 40_000;

const STEPS = [
  { side: 2048, compress: 0.85 },
  { side: 1568, compress: 0.75 },
  { side: 1280, compress: 0.6 },
  { side: 1024, compress: 0.5 },
];

let seq = 0;

async function encode(asset: ImagePicker.ImagePickerAsset, budget: number): Promise<Attachment> {
  const long = Math.max(asset.width, asset.height);
  for (const step of STEPS) {
    const ctx = ImageManipulator.manipulate(asset.uri);
    if (long > step.side) ctx.resize(asset.width >= asset.height ? { width: step.side } : { height: step.side });
    const image = await ctx.renderAsync();
    const out = await image.saveAsync({ format: SaveFormat.JPEG, compress: step.compress, base64: true });
    if (out.base64 && out.base64.length <= budget) {
      return { key: `a${++seq}`, uri: out.uri, mime: 'image/jpeg', dataBase64: out.base64 };
    }
  }
  throw new Error('Photo is too large to send');
}

export const attachmentChars = (list: readonly Attachment[]) => list.reduce((n, a) => n + a.dataBase64.length, 0);

/** Opens the camera or the gallery and returns photos compressed to fit the remaining message budget. */
export async function pickPhotos(source: 'camera' | 'library', existing: readonly Attachment[]): Promise<Attachment[]> {
  const slots = MAX_ATTACHMENTS - existing.length;
  let budget = MAX_ATTACHMENT_CHARS - attachmentChars(existing);
  if (slots <= 0 || budget < MIN_USEFUL_CHARS) throw new Error(`Up to ${MAX_ATTACHMENTS} photos per message`);

  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Camera access is off for Pocket');
    result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  } else {
    result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: slots > 1, selectionLimit: slots, quality: 1 });
  }
  if (result.canceled) return [];

  const out: Attachment[] = [];
  for (const asset of result.assets.slice(0, slots)) {
    if (budget < MIN_USEFUL_CHARS) break;
    const a = await encode(asset, budget);
    budget -= a.dataBase64.length;
    out.push(a);
  }
  return out;
}

let clipSeq = 0;

/** Turns what came from the PC clipboard into attachments; text is returned separately for the input field. */
export function fromClipboard(items: readonly ClipboardItem[]): { text: string; attachments: Attachment[] } {
  const texts: string[] = [];
  const attachments: Attachment[] = [];
  for (const it of items) {
    if (it.kind === 'text') texts.push(it.text);
    else if (it.kind === 'image') attachments.push({ key: `c${++clipSeq}`, mime: it.mime, dataBase64: it.dataBase64 });
    else attachments.push({ key: `c${++clipSeq}`, mime: it.mime, dataBase64: it.dataBase64, name: it.name });
  }
  return { text: texts.join('\n'), attachments };
}

export const previewUri = (a: Attachment) => a.uri ?? (a.mime.startsWith('image/') ? `data:${a.mime};base64,${a.dataBase64}` : undefined);
