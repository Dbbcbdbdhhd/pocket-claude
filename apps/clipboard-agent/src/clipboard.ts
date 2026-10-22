import { execFile, spawn } from 'node:child_process';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ClipboardItem } from '@pocket/protocol';

/** One clipboard item may be up to this big; the relay carries ~32 MB per frame including base64. */
export const MAX_ITEM_BYTES = 20 * 1024 * 1024;

export interface ClipboardBackend {
  read(): Promise<ClipboardItem[]>;
  write(item: ClipboardItem): Promise<void>;
}

const MIME: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.log': 'text/plain',
  '.html': 'text/html',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export const mimeOf = (file: string) => MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

/** Reads files named on the clipboard; folders and oversized files become a short text note instead. */
export async function filesToItems(paths: string[]): Promise<ClipboardItem[]> {
  const items: ClipboardItem[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const p of paths) {
    try {
      const st = await stat(p);
      if (!st.isFile()) {
        skipped.push(`${path.basename(p)} (folder)`);
        continue;
      }
      if (st.size > MAX_ITEM_BYTES || total + st.size > MAX_ITEM_BYTES) {
        skipped.push(`${path.basename(p)} (${Math.round(st.size / 1024 / 1024)} MB, too large)`);
        continue;
      }
      const data = await readFile(p);
      total += data.length;
      items.push({ kind: 'file', name: path.basename(p), mime: mimeOf(p), dataBase64: data.toString('base64'), size: data.length });
    } catch (e) {
      skipped.push(`${path.basename(p)} (${e instanceof Error ? e.message : 'unreadable'})`);
    }
  }
  if (skipped.length) items.push({ kind: 'text', text: `Not copied: ${skipped.join(', ')}` });
  return items;
}

// Windows PowerShell 5.1 ships with every Windows 10/11 and can reach the clipboard through WinForms.
const READ_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$out = @{ kind = 'empty' }
if ([Windows.Forms.Clipboard]::ContainsFileDropList()) {
  $out.kind = 'files'; $out.files = @([Windows.Forms.Clipboard]::GetFileDropList())
} elseif ([Windows.Forms.Clipboard]::ContainsImage()) {
  $img = [Windows.Forms.Clipboard]::GetImage()
  $max = 2560
  if ($img.Width -gt $max -or $img.Height -gt $max) {
    $k = [Math]::Min($max / $img.Width, $max / $img.Height)
    $img = New-Object Drawing.Bitmap $img, ([int]($img.Width * $k)), ([int]($img.Height * $k))
  }
  $p = Join-Path $env:TEMP ('pocket-clip-' + [guid]::NewGuid() + '.png')
  $img.Save($p, [Drawing.Imaging.ImageFormat]::Png)
  if ((Get-Item $p).Length -gt 3MB) {
    Remove-Item $p
    $p = [IO.Path]::ChangeExtension($p, '.jpg')
    $enc = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $prm = New-Object Drawing.Imaging.EncoderParameters 1
    $prm.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality), 85L
    $img.Save($p, $enc, $prm)
  }
  $out.kind = 'image'; $out.path = $p
} elseif ([Windows.Forms.Clipboard]::ContainsText()) {
  $out.kind = 'text'; $out.text = [Windows.Forms.Clipboard]::GetText()
}
$out | ConvertTo-Json -Compress -Depth 3
`;

const WRITE_TEXT_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
[Console]::InputEncoding = [Text.Encoding]::UTF8
$t = [Console]::In.ReadToEnd()
[Windows.Forms.Clipboard]::SetText($t)
`;

const WRITE_IMAGE_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$img = [Drawing.Image]::FromFile($env:POCKET_CLIP_FILE)
[Windows.Forms.Clipboard]::SetImage($img)
$img.Dispose()
`;

function powershell(script: string, opts: { stdin?: string; env?: Record<string, string> } = {}): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
      env: { ...process.env, ...opts.env },
    });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim().split('\n')[0] || `PowerShell exited with ${code}`))));
    if (opts.stdin !== undefined) child.stdin.end(opts.stdin, 'utf8');
    else child.stdin.end();
  });
}

export const windowsClipboard: ClipboardBackend = {
  async read() {
    const raw = (await powershell(READ_PS)).trim().replace(/^\uFEFF/, '');
    const r = JSON.parse(raw) as { kind: string; text?: string; path?: string; files?: string[] | string };
    if (r.kind === 'text' && r.text) return [{ kind: 'text', text: r.text }];
    if (r.kind === 'image' && r.path) {
      try {
        const data = await readFile(r.path);
        return [{ kind: 'image', mime: r.path.endsWith('.jpg') ? 'image/jpeg' : 'image/png', dataBase64: data.toString('base64') }];
      } finally {
        await rm(r.path, { force: true });
      }
    }
    if (r.kind === 'files' && r.files) return filesToItems(Array.isArray(r.files) ? r.files : [r.files]);
    return [];
  },
  async write(item) {
    if (item.kind === 'text') {
      if (!item.text) throw new Error('Nothing to copy');
      await powershell(WRITE_TEXT_PS, { stdin: item.text });
      return;
    }
    const ext = item.kind === 'image' ? (item.mime === 'image/jpeg' ? '.jpg' : '.png') : path.extname(item.name) || '.bin';
    if (item.kind === 'file' && !item.mime.startsWith('image/')) throw new Error('Only text and pictures can go to the clipboard');
    const file = path.join(os.tmpdir(), `pocket-clip-in-${Date.now()}${ext}`);
    await writeFile(file, Buffer.from(item.dataBase64, 'base64'));
    try {
      await powershell(WRITE_IMAGE_PS, { env: { POCKET_CLIP_FILE: file } });
    } finally {
      await rm(file, { force: true });
    }
  },
};

/** macOS text-only clipboard so the agent can be tried on a Mac during development. */
export const macClipboard: ClipboardBackend = {
  read: () =>
    new Promise((resolve, reject) =>
      execFile('pbpaste', (e, out) => (e ? reject(e) : resolve(out ? [{ kind: 'text', text: out }] : []))),
    ),
  write: (item) =>
    new Promise((resolve, reject) => {
      if (item.kind !== 'text') return reject(new Error('Only text on macOS'));
      const child = spawn('pbcopy');
      child.on('close', () => resolve());
      child.on('error', reject);
      child.stdin.end(item.text, 'utf8');
    }),
};
