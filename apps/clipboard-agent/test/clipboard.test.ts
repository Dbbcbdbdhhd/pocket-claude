import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { filesToItems, MAX_ITEM_BYTES, mimeOf } from '../src/clipboard.js';

describe('clipboard files', () => {
  it('reads copied files and notes what it skipped', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-'));
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
    fs.mkdirSync(path.join(dir, 'folder'));
    const items = await filesToItems([path.join(dir, 'a.txt'), path.join(dir, 'folder'), path.join(dir, 'missing.pdf')]);
    expect(items[0]).toMatchObject({ kind: 'file', name: 'a.txt', mime: 'text/plain', size: 5 });
    expect(Buffer.from((items[0] as { dataBase64: string }).dataBase64, 'base64').toString()).toBe('hello');
    expect(items[1]).toMatchObject({ kind: 'text' });
    expect((items[1] as { text: string }).text).toMatch(/folder.*missing\.pdf/s);
  });

  it('refuses files over the limit', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-'));
    const big = path.join(dir, 'big.bin');
    fs.writeFileSync(big, Buffer.alloc(16));
    fs.truncateSync(big, MAX_ITEM_BYTES + 1);
    const items = await filesToItems([big]);
    expect(items).toEqual([{ kind: 'text', text: expect.stringContaining('too large') }]);
  });

  it('guesses common mime types', () => {
    expect(mimeOf('x.PNG')).toBe('image/png');
    expect(mimeOf('report.pdf')).toBe('application/pdf');
    expect(mimeOf('blob')).toBe('application/octet-stream');
  });
});
