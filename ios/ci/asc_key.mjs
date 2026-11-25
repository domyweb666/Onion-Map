// 把 App Store Connect API 金鑰從 secret 還原成 .p8 檔，先驗再用。
// 用法：node ios/ci/asc_key.mjs <輸出路徑> [--check-app <bundle id>]
//
// 先試 ASC_PRIVATE_KEY，不行再試 ASC_KEY_P8_BASE64。兩個都吃這幾種放法：
//   .p8 原文、換行掉光變成一行的原文、換行變成 \n 兩個字元的原文、整個檔案的 base64、只有中間那段
// 2026-11-25 踩到：貼進 secret 的金鑰換行不見，altool 到最後一步才說 not a valid authentication key。
//
// repo 是公開的，log 誰都看得到：只印形狀（行數、位元組數），不印內容、Key ID、Issuer ID。
import { createPrivateKey, sign } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const fail = msg => { console.log('::error::' + msg); process.exit(1); };

// 一段 PEM 或它的殘骸 → 乾淨的 base64
function body(text) {
  return text
    .replace(/\\r|\\n/g, ' ')
    .replace(/-*\s*(BEGIN|END)\s+(EC\s+)?PRIVATE\s+KEY\s*-*/g, ' ')
    .replace(/[^A-Za-z0-9+/=]/g, '');
}

function tryDer(b64) {
  if (!b64) return null;
  const der = Buffer.from(b64, 'base64');
  for (const type of ['pkcs8', 'sec1']) {
    try {
      const key = createPrivateKey({ key: der, format: 'der', type });
      if (key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails.namedCurve === 'prime256v1') return key;
    } catch { /* 換下一種 */ }
  }
  return null;
}

export function parseKey(raw) {
  const text = String(raw || '').replace(/^﻿/, '').trim();
  if (!text) return null;
  const direct = tryDer(body(text));
  if (direct) return direct;
  // 整個 .p8 檔案再編一次 base64 的放法；有些工具存成 UTF-16，也試一次
  const bytes = Buffer.from(text.replace(/\s/g, ''), 'base64');
  for (const enc of ['utf8', 'utf16le']) {
    const key = tryDer(body(bytes.toString(enc)));
    if (key) return key;
  }
  return null;
}

function shape(raw) {
  const t = String(raw || '');
  return `${t.split('\n').length} 行、${Buffer.byteLength(t)} bytes、` +
    `有 BEGIN：${/BEGIN (EC )?PRIVATE KEY/.test(t) ? '是' : '否'}、有 END：${/END (EC )?PRIVATE KEY/.test(t) ? '是' : '否'}、` +
    `中間剩 ${body(t).length} 個字（正常 200）`;
}

async function checkApp(key, bundleId) {
  const { ASC_KEY_ID, ASC_ISSUER_ID } = process.env;
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'ES256', kid: String(ASC_KEY_ID).trim(), typ: 'JWT' }) + '.' +
    enc({ iss: String(ASC_ISSUER_ID).trim(), iat: now, exp: now + 300, aud: 'appstoreconnect-v1' });
  const sig = sign('sha256', Buffer.from(head), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  let res;
  try {
    res = await fetch('https://api.appstoreconnect.apple.com/v1/apps?fields[apps]=bundleId&filter[bundleId]=' +
      encodeURIComponent(bundleId), { headers: { Authorization: `Bearer ${head}.${sig}` } });
  } catch (e) {
    console.log('::warning::連不到 App Store Connect，先跳過這項檢查');
    return;
  }
  if (res.status === 401) fail('App Store Connect 不認這把金鑰（401）：ASC_KEY_ID、ASC_ISSUER_ID 要跟 .p8 是同一把，金鑰也要還沒撤銷');
  if (!res.ok) { console.log(`::warning::App Store Connect 回 ${res.status}，先跳過這項檢查`); return; }
  // filter[bundleId] 會連開頭相同的一起回，要自己比對
  const found = (await res.json()).data.some(a => a.attributes.bundleId === bundleId);
  if (!found) fail(`App Store Connect 還沒有 ${bundleId} 這個 App（或這把金鑰看不到），照 docs/上架指南.md 先建`);
  console.log(`App Store Connect 認得這把金鑰，也有 ${bundleId}`);
}

async function main() {
  const [out, flag, bundleId] = process.argv.slice(2);
  if (!out) fail('要給輸出路徑');
  let key = null;
  for (const name of ['ASC_PRIVATE_KEY', 'ASC_KEY_P8_BASE64']) {
    const raw = process.env[name];
    if (!raw) { console.log(`${name}：沒有放`); continue; }
    key = parseKey(raw);
    console.log(`${name}：${key ? '可用' : '不是有效的金鑰'}（${shape(raw)}）`);
    if (key) break;
  }
  if (!key) fail('兩個 secret 都還原不出有效的 .p8 金鑰，從 .p8 檔重放 ASC_PRIVATE_KEY（docs/上架指南.md 第三節）');
  writeFileSync(out, key.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  if (flag === '--check-app') await checkApp(key, bundleId);
}

if (process.argv[1] && process.argv[1].endsWith('asc_key.mjs')) await main();
