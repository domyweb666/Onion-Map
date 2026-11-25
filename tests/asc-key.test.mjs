// 上傳 TestFlight 用的金鑰還原：各種貼壞的放法都要救得回來，救不回來要認得出來。金鑰是當場產生的假貨
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { parseKey } from '../ios/ci/asc_key.mjs';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const same = raw => {
  const key = parseKey(raw);
  assert.ok(key);
  assert.equal(key.export({ type: 'pkcs8', format: 'pem' }), pem);
};
const b64 = (s, enc) => Buffer.from(s, enc).toString('base64');
const NL = String.fromCharCode(10), CR = String.fromCharCode(13), SLASH_N = String.fromCharCode(92) + 'n';

test('原文、Windows 換行、檔頭有 BOM', () => {
  same(pem);
  same(pem.replaceAll(NL, CR + NL));
  same(String.fromCharCode(0xfeff) + pem);
});
test('換行掉光、換成空格、換成字面的反斜線 n、外面包引號', () => {
  same(pem.replaceAll(NL, ''));
  same(pem.replaceAll(NL, ' '));
  same(pem.replaceAll(NL, SLASH_N));
  same('"' + pem.replaceAll(NL, SLASH_N) + '"');
});
test('只有中間那段、整檔 base64、base64 又折行、UTF-16 存檔', () => {
  same(pem.split(NL).filter(l => !l.startsWith('-')).join(NL));
  same(b64(pem));
  same(b64(pem).replace(/(.{76})/g, '$1' + NL));
  same(b64(String.fromCharCode(0xfeff) + pem, 'utf16le'));
});
test('SEC1 格式的 EC 金鑰', () => same(privateKey.export({ type: 'sec1', format: 'pem' })));
test('空的、被截斷的、不是金鑰的、別種曲線都不收', () => {
  for (const bad of ['', undefined, 'hello', pem.slice(0, 120), b64('not a key'),
    generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }),
  ]) assert.equal(parseKey(bad), null);
});
