// 在真的 workerd 裡跑 Worker 和 Durable Object，只有 OpenAI 是假的，不花錢。
import { env, exports } from 'cloudflare:workers';
import { reset, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { dayOf, sniff } from '../src/index.mjs';

// 只有檔頭的假圖，夠它量寬高
function pngB64(w = 1024, h = 1536) {
  const b = new Uint8Array(60);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return btoa(String.fromCharCode(...b));
}
const JPEG = btoa(
  String.fromCharCode(
    ...'ffd8ffe000104a46494600010100000100010000ffc0000b080600040001011100ffda0000'.match(/../g).map((x) => parseInt(x, 16)),
  ),
);

let ai; // 這次測試的假 OpenAI：(form) => Response
let calls; // 叫了幾次、每次的表單
let ip = 0;

beforeEach(() => {
  calls = [];
  ai = () => Response.json({ data: [{ b64_json: JPEG }] });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    expect(String(url)).toBe('https://api.openai.com/v1/images/edits');
    expect(init.headers.Authorization).toBe('Bearer fake-key');
    calls.push(init.body);
    return ai(init.body, init);
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await reset();
});

const dev = (n) => `device-${String(n).padStart(16, '0')}`;

async function call(method, path, { token = dev(1), body, headers } = {}) {
  ip += 1; // 每次換一個 IP，免得撞到速率限制
  const r = await exports.default.fetch(`https://painter.test${path}`, {
    method,
    headers: { 'X-Onion-Token': token, 'CF-Connecting-IP': `10.0.${ip >> 8}.${ip & 255}`, ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await r.text();
  return { code: r.status, body: text ? JSON.parse(text) : null, headers: r.headers };
}
const paint = (token = dev(1), kind = 'day') => call('POST', '/paint', { token, body: { kind, style: 'pencil', image: pngB64() } });
const left = async (token = dev(1)) => (await call('GET', '/ping', { token })).body.left;

async function until(id, want, token = dev(1)) {
  for (let i = 0; i < 100; i += 1) {
    const r = await call('GET', `/paint/${id}`, { token });
    if (r.body.status === want) return r.body;
    await new Promise((ok) => setTimeout(ok, 30));
  }
  throw new Error(`一直沒有變成 ${want}`);
}
const stub = (id) => env.JOB.getByName(id);

test('ping → paint → 輪詢 → image → delete，送給 OpenAI 的東西對', async () => {
  const ping = await call('GET', '/ping');
  expect(ping.body).toEqual({ ok: true, name: '雲端', kind: 'cloud', engine: 'openai', left: 1 });
  const post = await paint();
  expect(post.code).toBe(202);
  const { id } = post.body;
  await until(id, 'done');
  const img = await call('GET', `/paint/${id}/image`);
  expect(img.body).toEqual({ image: JPEG, mime: 'image/jpeg' });
  expect(await left()).toBe(0);

  expect(calls.length).toBe(1);
  const f = calls[0];
  expect(f.get('model')).toBe('gpt-image-2.6-sunburst');
  expect(f.get('size')).toBe('1024x1536');
  expect(f.get('prompt')).toContain('色鉛筆');
  expect(f.get('input_fidelity')).toBe(null);
  expect(f.get('image[]').type).toBe('image/png');
  expect(f.get('image[]').size).toBe(60);
  await runInDurableObject(stub(id), (o) => expect(o.getText('in')).toBe(''));

  expect((await call('DELETE', `/paint/${id}`)).body).toEqual({ ok: true });
  expect((await call('GET', `/paint/${id}`)).code).toBe(404);
  expect(await left()).toBe(0);
});

test('一個裝置一天一張，第二張 429；別人的不受影響，也看不到我的', async () => {
  const a = await paint();
  await until(a.body.id, 'done');
  const again = await paint();
  expect(again.code).toBe(429);
  expect(again.body.error).toContain('明天');
  expect((await paint(dev(2))).code).toBe(202);
  expect((await call('GET', `/paint/${a.body.id}`, { token: dev(2) })).code).toBe(404);
  expect((await call('DELETE', `/paint/${a.body.id}`, { token: dev(2) })).code).toBe(404);
});

test('全站每天的總量：二十個人同時送，剛好只過三個', async () => {
  const all = await Promise.all(Array.from({ length: 20 }, (_, i) => paint(dev(100 + i))));
  expect(all.filter((r) => r.code === 202).length).toBe(3);
  const no = all.filter((r) => r.code === 429);
  expect(no.length).toBe(17);
  expect(no[0].body.error).toContain('上限');
  expect(await left(dev(999))).toBe(0);
});

test('台北時間半夜換日', async () => {
  expect(dayOf(Date.parse('2026-11-25T15:59:59Z'))).toBe('2026-11-25');
  expect(dayOf(Date.parse('2026-11-25T16:00:00Z'))).toBe('2026-11-26');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-25T15:59:00Z')); // 台北 23:59
  const q = env.QUOTA.getByName('main');
  expect((await q.reserve('j1', 'd')).ok).toBe(true);
  expect((await q.reserve('j2', 'd')).ok).toBe(false);
  expect(await q.left('d')).toBe(0);
  vi.setSystemTime(Date.parse('2026-11-25T16:00:30Z')); // 台北 00:00
  expect(await q.left('d')).toBe(1);
  expect((await q.reserve('j3', 'd')).ok).toBe(true);
  // 昨天那張現在才失敗，還的是昨天的，今天的不會多一張
  await q.refund('j1');
  expect(await q.left('d')).toBe(0);
  // 舊的紀錄會清掉
  vi.setSystemTime(Date.parse('2026-12-01T00:00:00Z'));
  await q.reserve('j4', 'd');
  await runInDurableObject(q, (o, s) => {
    expect(s.storage.sql.exec('SELECT id FROM jobs').toArray()).toEqual([{ id: 'j4' }]);
  });
});

test('失敗不扣：被擋下來會還張數，錯誤講人話', async () => {
  ai = () => Response.json({ error: { code: 'moderation_blocked', message: 'secret detail' } }, { status: 400 });
  const { id } = (await paint()).body;
  const s = await until(id, 'failed');
  expect(s.error).toContain('被擋下來');
  expect(s.error).not.toContain('secret');
  expect(calls.length).toBe(1);
  await vi.waitFor(async () => expect(await left()).toBe(1));
  const day = env.QUOTA.getByName('main');
  await runInDurableObject(day, (o, st) => {
    expect(st.storage.sql.exec('SELECT refunded FROM jobs').toArray()).toEqual([{ refunded: 1 }]);
  });
});

test('失敗不扣，可是一天最多試五次', async () => {
  ai = () => Response.json({ error: { code: 'bad' } }, { status: 400 });
  for (let i = 0; i < 5; i += 1) {
    const r = await paint();
    expect(r.code).toBe(202);
    await until(r.body.id, 'failed');
    await vi.waitFor(async () => expect(await left()).toBe(1));
  }
  const r = await paint();
  expect(r.code).toBe(429);
  expect(r.body.error).toContain('試太多次');
});

test('OpenAI 很忙會再試一次，第二次成功', async () => {
  ai = () => (calls.length === 1 ? Response.json({ error: {} }, { status: 503 }) : Response.json({ data: [{ b64_json: JPEG }] }));
  const { id } = (await paint()).body;
  await vi.waitFor(async () => {
    await runInDurableObject(stub(id), async (o, s) => {
      expect(calls.length).toBe(1);
      expect(await s.storage.getAlarm()).toBeLessThan(Date.now() + 60 * 1000);
    });
  });
  expect(await runDurableObjectAlarm(stub(id))).toBe(true);
  await until(id, 'done');
  expect(calls.length).toBe(2);
  expect(await left()).toBe(0);
});

test('一直很忙：試兩次就停，張數還回去，不會一直付錢', async () => {
  ai = () => Response.json({ error: {} }, { status: 500 });
  const { id } = (await paint()).body;
  await vi.waitFor(async () => {
    await runInDurableObject(stub(id), async (o, s) => {
      expect(calls.length).toBe(1);
      expect(await s.storage.getAlarm()).toBeLessThan(Date.now() + 60 * 1000);
    });
  });
  await runDurableObjectAlarm(stub(id));
  expect((await until(id, 'failed')).error).toContain('很忙');
  await runDurableObjectAlarm(stub(id));
  await runDurableObjectAlarm(stub(id));
  expect(calls.length).toBe(2);
  await vi.waitFor(async () => expect(await left()).toBe(1));
});

test('預算用完、金鑰不對：不重試，張數還回去', async () => {
  ai = () => Response.json({ error: { code: 'insufficient_quota' } }, { status: 429 });
  const a = (await paint()).body.id;
  expect((await until(a, 'failed')).error).toContain('預算');
  ai = () => Response.json({ error: { code: 'invalid_api_key' } }, { status: 401 });
  const b = (await paint(dev(2))).body.id;
  expect((await until(b, 'failed', dev(2))).error).toContain('設定');
  expect(calls.length).toBe(2);
});

test('扣完張數就壞掉：一分鐘後的 alarm 會還回去', async () => {
  const id = 'f'.repeat(32);
  const q = env.QUOTA.getByName('main');
  await q.reserve(id, 'd');
  await runInDurableObject(stub(id), async (o, s) => {
    o.job = { id, device: 'd', kind: 'day', style: 'pencil', status: 'reserving', tries: 0, created: Date.now() };
    await s.storage.setAlarm(Date.now() + 60 * 1000);
  });
  expect(await q.left('d')).toBe(0);
  expect(await runDurableObjectAlarm(stub(id))).toBe(true);
  expect(await q.left('d')).toBe(1);
  expect(calls.length).toBe(0);
});

test('24 小時後清得乾乾淨淨；還沒到就不清', async () => {
  const { id } = (await paint()).body;
  await until(id, 'done');
  await vi.waitFor(() =>
    runInDurableObject(stub(id), async (o, s) => {
      expect((await s.storage.getAlarm()) - Date.now()).toBeGreaterThan(23.9 * 3600 * 1000);
    }),
  );
  await runDurableObjectAlarm(stub(id));
  expect((await call('GET', `/paint/${id}/image`)).code).toBe(200);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 24 * 3600 * 1000 + 1000);
  await runDurableObjectAlarm(stub(id));
  expect((await call('GET', `/paint/${id}`)).code).toBe(404);
  await runInDurableObject(stub(id), async (o, s) => {
    expect((await s.storage.list()).size).toBe(0);
    expect(await s.storage.getAlarm()).toBe(null);
  });
});

test('畫到一半刪掉：停下來、不留東西、張數不還', async () => {
  let aborted = false;
  ai = (form, init) =>
    new Promise((_, no) => {
      init.signal.addEventListener('abort', () => {
        aborted = true;
        no(new DOMException('', 'AbortError'));
      });
    });
  const { id } = (await paint()).body;
  await until(id, 'painting');
  expect((await call('GET', `/paint/${id}/image`)).code).toBe(409);
  expect((await call('DELETE', `/paint/${id}`)).code).toBe(200);
  await vi.waitFor(() => expect(aborted).toBe(true));
  await new Promise((ok) => setTimeout(ok, 50));
  expect((await call('GET', `/paint/${id}`)).code).toBe(404);
  await runInDurableObject(stub(id), async (o, s) => expect((await s.storage.list()).size).toBe(0));
  expect(await left()).toBe(0);
});

test('大圖切塊存，拿回來一個字都沒少', async () => {
  const big = JPEG.slice(0, -4).replace(/=+$/, '') + 'A'.repeat(4 * Math.ceil(900000)) ;
  ai = () => Response.json({ data: [{ b64_json: big }] });
  const { id } = (await paint()).body;
  await until(id, 'done');
  const img = await call('GET', `/paint/${id}/image`);
  expect(img.body.image.length).toBe(big.length);
  expect(img.body.image === big).toBe(true);
});

test('擋掉的：沒代號、太大、不是圖片、尺寸不對、沒有這種畫法，都不扣', async () => {
  expect((await call('GET', '/ping', { token: 'short' })).code).toBe(401);
  expect((await call('POST', '/paint', { body: 'x'.repeat(12 * 1024 * 1024 + 1) })).code).toBe(413);
  const ok = { kind: 'day', style: 'pencil', image: pngB64() };
  expect((await call('POST', '/paint', { body: '不是 JSON' })).code).toBe(400);
  expect((await call('POST', '/paint', { body: { ...ok, image: btoa('hello, this is not an image at all ok') } })).code).toBe(400);
  expect((await call('POST', '/paint', { body: { ...ok, image: pngB64(4096, 100) } })).code).toBe(400);
  expect((await call('POST', '/paint', { body: { ...ok, kind: 'constructor' } })).code).toBe(400);
  expect((await call('GET', '/nope')).code).toBe(404);
  expect(await left()).toBe(1);
  expect(calls.length).toBe(0);
});

test('同一個 IP 送太快會被擋', async () => {
  const headers = { 'CF-Connecting-IP': '203.0.113.9' };
  const codes = [];
  for (let i = 0; i < 9; i += 1) codes.push((await call('POST', '/paint', { body: '{}', headers })).code);
  expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
  expect(codes[0]).toBe(400);
});

test('CORS 只放行本機網頁', async () => {
  const good = await call('OPTIONS', '/paint', { headers: { Origin: 'http://onion.localhost:8080' } });
  expect(good.code).toBe(204);
  expect(good.headers.get('access-control-allow-origin')).toBe('http://onion.localhost:8080');
  const bad = await call('GET', '/ping', { headers: { Origin: 'https://evil.example' } });
  expect(bad.code).toBe(403);
  expect(bad.headers.get('access-control-allow-origin')).toBe(null);
});

test('認得 JPEG 的寬高', () => {
  expect(sniff(JPEG)).toEqual({ mime: 'image/jpeg', w: 1024, h: 1536 });
  expect(sniff('AAAA')).toBe(null);
  expect(sniff('<svg>')).toBe(null);
});
