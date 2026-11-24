// 不叫真的 Codex、不花額度。前半用假畫圖模式走完介面，後半用一支假的 codex 看交出去的參數。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { encodePng, fakePaint, sniff } from './images.mjs';
import { KINDS, STYLES, promptFor } from './prompts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'onion-painter-test-'));
const running = new Set();
after(async () => {
  for (const s of running) await s.stop();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

// 不同 shade 就是不同的圖，伺服器才不會當成同一張
function png(w = 300, h = 450, shade = 200) {
  return encodePng(w, h, Buffer.alloc(w * h * 3, shade));
}
const b64 = (shade) => png(300, 450, shade).toString('base64');

async function freePort() {
  const s = net.createServer().listen(0);
  await once(s, 'listening');
  const { port } = s.address();
  s.close();
  await once(s, 'close');
  return port;
}

async function open(home, env = {}, args = []) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(HERE, 'painter.mjs'), ...args], {
    env: { ...process.env, PORT: String(port), ONION_HOME: home, ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let out = '';
  child.stdout.setEncoding('utf8');
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => {
      out += d;
      if (out.includes('Ctrl+C') || out.includes('找不到區網')) resolve();
    });
    child.on('exit', (code) => reject(new Error(`沒開起來：${code}\n${out}`)));
  });
  const token = fs.readFileSync(path.join(home, 'token'), 'utf8');
  const base = `http://127.0.0.1:${port}`;
  const s = {
    base,
    port,
    token,
    out: () => out,
    async call(method, url, body, headers = {}) {
      const r = await fetch(base + url, {
        method,
        headers: { 'X-Onion-Token': token, ...headers },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      });
      const text = await r.text();
      return { code: r.status, headers: r.headers, body: text ? JSON.parse(text) : null };
    },
    paint: (shade, kind = 'day') => s.call('POST', '/paint', { kind, style: 'pencil', image: b64(shade) }),
    async finish(id) {
      for (let i = 0; i < 100; i += 1) {
        const r = await s.call('GET', `/paint/${id}`);
        if (r.body.status === 'done' || r.body.status === 'failed') return r.body;
        await new Promise((ok) => setTimeout(ok, 100));
      }
      throw new Error('等太久');
    },
    async stop() {
      running.delete(s);
      if (child.exitCode !== null || child.signalCode) return;
      child.kill('SIGKILL');
      await once(child, 'exit');
    },
  };
  running.add(s);
  return s;
}

const fake = (name, ms = 300) => open(path.join(TMP, name), { ONION_FAKE: '1', ONION_FAKE_MS: String(ms) });

test('ping → paint → 輪詢 → image → delete', async () => {
  const s = await fake('flow');
  const ping = await s.call('GET', '/ping');
  assert.equal(ping.code, 200);
  assert.deepEqual(ping.body, { ok: true, name: os.hostname(), kind: 'pc', engine: 'codex' });

  const post = await s.paint(180);
  assert.equal(post.code, 202);
  const { id } = post.body;
  const early = await s.call('GET', `/paint/${id}`);
  assert.equal(early.body.status, 'painting');
  assert.equal(early.body.ahead, 0);
  assert.equal((await s.call('GET', `/paint/${id}/image`)).code, 409);

  const end = await s.finish(id);
  assert.equal(end.status, 'done');
  assert.equal(typeof end.seconds, 'number');
  const img = await s.call('GET', `/paint/${id}/image`);
  assert.equal(img.body.mime, 'image/png');
  const info = sniff(Buffer.from(img.body.image, 'base64'));
  assert.deepEqual([info.w, info.h], [300, 450]);
  assert.notEqual(img.body.image, b64(180), '假畫圖要看得出有換過');

  assert.deepEqual((await s.call('DELETE', `/paint/${id}`)).body, { ok: true });
  assert.equal((await s.call('GET', `/paint/${id}`)).code, 404);
  assert.equal(fs.existsSync(path.join(TMP, 'flow', 'jobs', id)), false);
  await s.stop();
});

test('QR 內容照約定', async () => {
  const s = await fake('qr');
  const m = s.out().match(/onion:\/\/pair\?u=(\S+?)&t=(\S+?)&n=(\S+)/);
  assert.match(decodeURIComponent(m[1]), new RegExp(`^http://[\\d.]+:${s.port}$`));
  assert.equal(m[2], s.token);
  assert.equal(decodeURIComponent(m[3]), os.hostname());
  await s.stop();
});

test('密碼錯、沒帶密碼都是 401', async () => {
  const s = await fake('auth');
  assert.equal((await s.call('GET', '/ping', undefined, { 'X-Onion-Token': 'x'.repeat(32) })).code, 401);
  assert.equal((await s.call('GET', '/ping', undefined, { 'X-Onion-Token': '' })).code, 401);
  assert.equal((await fetch(`${s.base}/ping`)).status, 401);
  await s.stop();
});

test('body 超過 12MB 回 413（有講長度跟沒講長度都擋）', async () => {
  const s = await fake('big');
  assert.equal((await s.call('POST', '/paint', 'x'.repeat(12 * 1024 * 1024 + 1))).code, 413);
  const code = await new Promise((resolve, reject) => {
    const req = http.request(`${s.base}/paint`, { method: 'POST', headers: { 'X-Onion-Token': s.token } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    const piece = Buffer.alloc(1024 * 1024, 120);
    for (let i = 0; i < 13; i += 1) req.write(piece);
    req.end();
  });
  assert.equal(code, 413);
  await s.stop();
});

test('不是圖片、尺寸不對、沒有這種畫法都是 400', async () => {
  const s = await fake('bad');
  const post = (body) => s.call('POST', '/paint', body);
  const ok = { kind: 'day', style: 'pencil', image: b64(1) };
  assert.equal((await post('不是 JSON')).code, 400);
  assert.equal((await post({ ...ok, image: undefined })).code, 400);
  assert.equal((await post({ ...ok, image: Buffer.from('hello, not an image').toString('base64') })).code, 400);
  assert.equal((await post({ ...ok, image: '<svg></svg>' })).code, 400);
  assert.equal((await post({ ...ok, kind: 'toString' })).code, 400);
  assert.equal((await post({ ...ok, style: 'oil' })).code, 400);
  assert.equal((await post({ ...ok, image: png(2049, 300).toString('base64') })).code, 400);
  assert.equal((await post({ ...ok, image: png(10, 10).toString('base64') })).code, 400);
  await s.stop();
});

test('一張在畫、三張在排，第五張 429；同一張送兩次拿到同一個號碼', async () => {
  const s = await fake('queue', 60000);
  const a = await s.paint(1);
  assert.equal((await s.paint(1)).body.id, a.body.id);
  const ids = [];
  for (const shade of [2, 3, 4]) ids.push((await s.paint(shade)).body.id);
  assert.equal((await s.paint(5)).code, 429);
  const q = await s.call('GET', `/paint/${ids[2]}`);
  assert.equal(q.body.status, 'queued');
  assert.equal(q.body.ahead, 3);
  await s.call('DELETE', `/paint/${ids[0]}`);
  assert.equal((await s.call('GET', `/paint/${ids[2]}`)).body.ahead, 2);
  assert.equal((await s.paint(5)).code, 202);
  await s.stop();
});

test('畫好了手機還沒拿走：同一張再送一次不會重畫；拿走之後再送才畫新的', async () => {
  const s = await fake('untaken', 100);
  const { id } = (await s.paint(7)).body;
  await s.finish(id);
  assert.equal((await s.paint(7)).body.id, id);
  await s.call('GET', `/paint/${id}/image`);
  assert.notEqual((await s.paint(7)).body.id, id);
  await s.stop();
});

test('重開之後：密碼不變、畫好的還拿得到、沒畫完的算失敗、過一天的清掉', async () => {
  const home = path.join(TMP, 'restart');
  const env = { ONION_FAKE: '1', ONION_FAKE_MS: '300' };
  const one = await open(home, env);
  const done = (await one.paint(10)).body.id;
  await one.finish(done);
  const old = (await one.paint(20)).body.id;
  await one.finish(old);
  await one.stop();
  const file = path.join(home, 'jobs', old, 'job.json');
  const job = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...job, ended: Date.now() - 25 * 3600 * 1000 }));

  const two = await open(home, { ...env, ONION_FAKE_MS: '60000' });
  assert.equal(two.token, one.token);
  assert.equal((await two.call('GET', `/paint/${done}/image`)).code, 200);
  assert.equal((await two.call('GET', `/paint/${old}`)).code, 404);
  assert.equal(fs.existsSync(path.join(home, 'jobs', old)), false);
  const half = (await two.paint(30)).body.id;
  await two.stop();

  const three = await open(home, env, ['--new-token']);
  assert.notEqual(three.token, one.token);
  const r = await three.call('GET', `/paint/${half}`);
  assert.equal(r.body.status, 'failed');
  assert.match(r.body.error, /再畫一次/);
  await three.stop();
});

test('CORS 只放行本機網頁', async () => {
  const s = await fake('cors');
  const pre = (origin) => fetch(`${s.base}/paint`, { method: 'OPTIONS', headers: { Origin: origin } });
  for (const o of ['http://localhost:5173', 'http://onion.localhost:8080', 'http://127.0.0.1:3000', 'capacitor://localhost']) {
    const r = await pre(o);
    assert.equal(r.status, 204, o);
    assert.equal(r.headers.get('access-control-allow-origin'), o);
    assert.match(r.headers.get('access-control-allow-headers'), /X-Onion-Token/);
  }
  for (const o of ['https://evil.example', 'http://localhost.evil.example', 'http://evil.example/?http://localhost:1', 'null']) {
    const r = await pre(o);
    assert.equal(r.status, 403, o);
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  }
  const bad = await fetch(`${s.base}/ping`, { headers: { 'X-Onion-Token': 'x', Origin: 'http://localhost:5173' } });
  assert.equal(bad.status, 401);
  assert.equal(bad.headers.get('access-control-allow-origin'), 'http://localhost:5173', '錯誤也要讓網頁讀得到');
  await s.stop();
});

test('提示詞：每種組合都有，雲端那份一模一樣', () => {
  for (const k of KINDS) for (const st of STYLES) assert.ok(promptFor(k, st).length > 100);
  assert.equal(promptFor('day', '__proto__'), '');
  const mine = fs.readFileSync(path.join(HERE, 'prompts.mjs'), 'utf8');
  const cloud = fs.readFileSync(path.join(HERE, '../../server/painter/src/prompts.mjs'), 'utf8');
  assert.equal(cloud, mine);
});

test('量得出 JPEG 的寬高；壞掉的 PNG 假畫圖原樣還回去', () => {
  const jpg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffc0000b080600040001011100ffda', 'hex');
  assert.deepEqual(sniff(jpg), { mime: 'image/jpeg', ext: 'jpg', w: 1024, h: 1536 });
  const broken = png().subarray(0, 60);
  assert.equal(fakePaint(broken), broken);
});

// ---------- 假的 codex ----------
const SESSION = '01a1efbf-b208-7530-8610-f732a2fd5d73';
const STUB = `
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('codex-cli 0.0.0 (stub)'); process.exit(0); }
const mode = fs.readFileSync(path.join(__dirname, 'mode.txt'), 'utf8');
fs.writeFileSync(path.join(__dirname, 'seen.json'), JSON.stringify({ args, env: process.env, cwd: process.cwd() }));
console.error('session id: ${SESSION}');
const out = path.join(__dirname, 'out.png');
if (mode === 'generated') {
  const dir = path.join(process.env.CODEX_HOME, 'generated_images', '${SESSION}');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(out, path.join(dir, 'exec-1.png'));
  fs.utimesSync(path.join(dir, 'exec-1.png'), new Date(), new Date());
}
if (mode === 'workdir') {
  fs.copyFileSync(out, 'picture.png');
  fs.utimesSync('picture.png', new Date(), new Date());
}
if (mode === 'limit') { console.error("ERROR: You've hit your usage limit. C:\\\\secret\\\\path"); process.exit(1); }
if (mode === 'crash') { console.error('boom C:\\\\secret\\\\path'); process.exit(3); }
if (mode === 'hang') setTimeout(() => {}, 600000);
`;

async function withStub(name, env = {}) {
  const dir = path.join(TMP, `stub-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'out.png'), png(640, 960, 90));
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, 'stub.js'), STUB);
    fs.writeFileSync(path.join(dir, 'codex.cmd'), '@"%dp0%\\stub.js" %*\r\n');
  } else {
    fs.writeFileSync(path.join(dir, 'codex'), `#!/usr/bin/env node\n${STUB}`, { mode: 0o755 });
  }
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  const sys = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32') : '/usr/bin:/bin';
  const s = await open(path.join(dir, 'home'), {
    [key]: [dir, sys, path.dirname(process.execPath)].join(path.delimiter),
    CODEX_HOME: path.join(dir, 'codexhome'),
    ONION_FAKE: '',
    OPENAI_API_KEY: 'should-not-pass',
    SOME_OTHER_SECRET: 'should-not-pass',
    ...env,
  });
  s.mode = (m) => fs.writeFileSync(path.join(dir, 'mode.txt'), m);
  s.seen = () => JSON.parse(fs.readFileSync(path.join(dir, 'seen.json'), 'utf8'));
  return s;
}

test('交給 codex 的參數、環境變數，還有兩個地方都找得到圖', async () => {
  const s = await withStub('ok');
  s.mode('generated');
  const a = (await s.paint(1)).body.id;
  assert.equal((await s.finish(a)).status, 'done');
  const img = await s.call('GET', `/paint/${a}/image`);
  assert.equal(sniff(Buffer.from(img.body.image, 'base64')).w, 640);

  const { args, env, cwd } = s.seen();
  assert.deepEqual(args.slice(0, 6), ['exec', '-m', 'gpt-5.6-terra', '--skip-git-repo-check', '-s', 'workspace-write']);
  assert.equal(args[6], '-C');
  assert.equal(path.resolve(args[7]).toLowerCase(), path.resolve(cwd).toLowerCase());
  assert.ok(args[8].includes('image generation') && args[8].includes(promptFor('day', 'pencil')));
  assert.equal(args[9], '-i');
  assert.ok(args[10].endsWith('input.png'));
  assert.equal(args.length, 11);
  assert.ok(!JSON.stringify(env).includes('should-not-pass'));

  s.mode('workdir');
  const b = (await s.paint(2, 'base')).body.id;
  assert.equal((await s.finish(b)).status, 'done');
  assert.ok(s.seen().args[8].includes(promptFor('base', 'pencil')));
  await s.stop();
});

test('codex 失敗：講人話，不把電腦上的路徑交出去', async () => {
  const s = await withStub('fail');
  const cases = [
    ['limit', /額度/],
    ['crash', /畫到一半停了/],
    ['nothing', /沒有畫出圖/],
  ];
  let shade = 1;
  for (const [mode, want] of cases) {
    s.mode(mode);
    const r = await s.finish((await s.paint((shade += 1))).body.id);
    assert.equal(r.status, 'failed');
    assert.match(r.error, want);
    assert.ok(!/secret|[A-Z]:\\/.test(r.error));
  }
  await s.stop();
});

test('超時會停下來；畫到一半刪掉會把程式砍掉，接著畫下一張', async () => {
  const s = await withStub('hang', { ONION_TIMEOUT_MS: '2500' });
  s.mode('hang');
  const a = (await s.paint(1)).body.id;
  const r = await s.finish(a);
  assert.equal(r.status, 'failed');
  assert.match(r.error, /太久/);
  const b = (await s.paint(2)).body.id;
  const c = (await s.paint(3)).body.id;
  await new Promise((ok) => setTimeout(ok, 800));
  s.mode('workdir');
  assert.equal((await s.call('DELETE', `/paint/${b}`)).code, 200);
  assert.equal((await s.finish(c)).status, 'done');
  assert.equal(fs.existsSync(path.join(TMP, 'stub-hang', 'home', 'jobs', b)), false);
  await s.stop();
});
