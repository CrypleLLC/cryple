import { keccak_256 } from '@noble/hashes/sha3.js';

const PAIRS = [
  ['run-1786882795959 (oldest)', '0x5b73c5498c1e3b4dba84de0f1833c4a029d90519', '0xc7f2cf4845c6db0e1a1e91ed41bcd0fcc1b0e141'],
  ['run-1786882942843',          '0x67b0cff584b13e9275ffc2ca6ebb2e94546d595b', '0x42c24c4c846ae7f5e935c537866672acd7eaf8c9'],
  ['run-1787082889510 (current)','0xa2cd247c12f087450f4991c92e6fbc7ce015a527', '0xc667f4d5997a40aeb4d6c0d45059e3ecb610a9cf'],
];

const PREFIX = '3d602d80600a3d3981f3363d3d373d3d3d363d73';
const SUFFIX = '5af43d82803e903d91602b57fd5bf3';
const hex = (b) => Buffer.from(b).toString('hex');
const bin = (h) => Uint8Array.from(Buffer.from(h.replace(/^0x/, '').toLowerCase(), 'hex'));
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const word = (n) => bin(BigInt(n).toString(16).padStart(64, '0'));

function derive(uncompressed, factory, implementation) {
  const x = uncompressed.slice(1, 33);
  const y = uncompressed.slice(33, 65);
  const salt = keccak_256(cat(x, y, new Uint8Array(32), word(0), word(0), new Uint8Array(32)));
  const codeHash = keccak_256(bin(PREFIX + implementation.replace(/^0x/, '').toLowerCase() + SUFFIX));
  return '0x' + hex(keccak_256(cat(new Uint8Array([0xff]), bin(factory), salt, codeHash)).slice(12));
}

const spki = process.argv[2];
const target = (process.argv[3] || '').toLowerCase();
if (!spki) { console.log('usage: node which-deployment.mjs <public_key_spki_base64> [expected_address]'); process.exit(1); }

const der = Uint8Array.from(Buffer.from(spki, 'base64'));
const uncompressed = der.slice(der.length - 65);
if (uncompressed[0] !== 0x04) { console.log('not an uncompressed P-256 point'); process.exit(1); }

for (const [label, factory, implementation] of PAIRS) {
  const a = derive(uncompressed, factory, implementation);
  const mark = target && a.toLowerCase() === target ? '   <<< MATCHES' : '';
  console.log(`${a}  ${label}${mark}`);
}
