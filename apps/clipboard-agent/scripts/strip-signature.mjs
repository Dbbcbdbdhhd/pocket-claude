// Removes the Authenticode signature from a PE file: clears the certificate table entry and drops the trailing blob.
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const buf = readFileSync(file);
const pe = buf.readUInt32LE(0x3c);
if (buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('not a PE file');
const opt = pe + 24;
const magic = buf.readUInt16LE(opt);
const dirs = opt + (magic === 0x20b ? 112 : 96);
const certEntry = dirs + 4 * 8;
const offset = buf.readUInt32LE(certEntry);
const size = buf.readUInt32LE(certEntry + 4);
if (!offset || !size) {
  console.log('no signature');
  process.exit(0);
}
buf.writeUInt32LE(0, certEntry);
buf.writeUInt32LE(0, certEntry + 4);
const out = offset + size === buf.length ? buf.subarray(0, offset) : buf;
writeFileSync(file, out);
console.log(`removed ${size} byte signature`);
