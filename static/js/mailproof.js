/* 메일을 보내는 요청 전의 사람 확인(app/mail_guard.py). 서버가 준 문제(challenge)에 숫자(nonce)를 붙여
   SHA-256을 했을 때 앞쪽 bits개 비트가 0이 되는 숫자를 찾는다. 보통 PC 0.1초, 휴대폰 0.5초 안팎.
   화면이 멈추지 않게 조금씩 나눠 계산한다. 한 문제는 한 번만 쓸 수 있다. */
import { api } from './core.js';

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const W = new Uint32Array(64);

function block(st, b, off) {
  for (let i = 0; i < 16; i++) W[i] = (b[off + i * 4] << 24) | (b[off + i * 4 + 1] << 16) | (b[off + i * 4 + 2] << 8) | b[off + i * 4 + 3];
  for (let i = 16; i < 64; i++) {
    const x = W[i - 15], y = W[i - 2];
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
  }
  let a = st[0], b2 = st[1], c = st[2], d = st[3], e = st[4], f = st[5], g = st[6], hh = st[7];
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (hh + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (S0 + ((a & b2) ^ (a & c) ^ (b2 & c))) | 0;
    hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b2; b2 = a; a = (t1 + t2) | 0;
  }
  st[0] = (st[0] + a) | 0; st[1] = (st[1] + b2) | 0; st[2] = (st[2] + c) | 0; st[3] = (st[3] + d) | 0;
  st[4] = (st[4] + e) | 0; st[5] = (st[5] + f) | 0; st[6] = (st[6] + g) | 0; st[7] = (st[7] + hh) | 0;
}

function zeroBits(st) {
  let n = 0;
  for (let i = 0; i < 8; i++) {
    const w = st[i] >>> 0;
    if (w === 0) { n += 32; continue; }
    return n + Math.clz32(w);
  }
  return n;
}

const enc = new TextEncoder();
const tick = () => new Promise((r) => setTimeout(r, 0));

/* 문제 하나를 풀어 { pow_challenge, pow_nonce }를 돌려준다. */
export async function solve(challenge, bits) {
  if (!bits) return { pow_challenge: challenge, pow_nonce: '0' };
  const prefix = enc.encode(`${challenge}:`);
  const full = Math.floor(prefix.length / 64) * 64;
  const mid = IV.slice();
  for (let off = 0; off < full; off += 64) block(mid, prefix, off);
  const rest = prefix.subarray(full);
  const buf = new Uint8Array(128);
  const st = new Int32Array(8);
  const digits = new Uint8Array(16);
  for (let nonce = 0; ; nonce++) {
    // 숫자를 문자로 바꾸는 일도 반복마다 하므로 직접 적는다(TextEncoder보다 몇 배 빠름).
    let nd = 0;
    for (let v = nonce; ; v = Math.floor(v / 10)) { digits[nd++] = 48 + (v % 10); if (v < 10) break; }
    const len = rest.length + nd;
    const end = len + 9 > 64 ? 128 : 64;
    buf.fill(0, 0, end);
    buf.set(rest, 0);
    for (let i = 0; i < nd; i++) buf[rest.length + i] = digits[nd - 1 - i];
    buf[len] = 0x80;
    const tb = (prefix.length + nd) * 8;
    buf[end - 4] = (tb >>> 24) & 255; buf[end - 3] = (tb >>> 16) & 255; buf[end - 2] = (tb >>> 8) & 255; buf[end - 1] = tb & 255;
    for (let i = 0; i < 8; i++) st[i] = mid[i];
    block(st, buf, 0);
    if (end === 128) block(st, buf, 64);
    if (zeroBits(st) >= bits) return { pow_challenge: challenge, pow_nonce: String(nonce) };
    if ((nonce & 16383) === 16383) await tick();
  }
}

/* 미리 풀어 두는 확인값. warm()은 화면을 열 때 미리 풀기 시작하고, take()는 그 값을 꺼내 쓴다(없으면 새로 푼다). */
export function mailProof() {
  let pending = null;
  const start = () => {
    pending = api('/api/auth/mail-challenge').then((c) => solve(c.challenge, c.bits));
    pending.catch(() => {});
  };
  return {
    warm: () => { if (!pending) start(); },
    async take() {
      if (!pending) start();
      const p = pending;
      pending = null;
      try { return await p; } catch { start(); const q = pending; pending = null; return q; }
    },
  };
}
