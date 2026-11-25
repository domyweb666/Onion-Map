// 清除全部紀錄：路線不能留在讀壞另存的 broken/，也不能留在暫存的匯出檔
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/js/15-store.js', import.meta.url), 'utf8');
const at = src.indexOf('async function wipeExports'), end = src.indexOf('async function wipeAll');
assert.ok(at > 0 && end > at);

function run(native) {
  const keys = new Set(['meta.json', 'days/2026-11-01.json', 'days/2026-11-02.json.tmp', 'cells/a.json', 'cards/2026-11-01.json', 'base/x.json', 'broken/meta.json-1', 'import-pending.json']);
  const cache = new Map([['onion-backup-2026-11-01.json', 'file'], ['onion-card-2026-11-01.png', 'file'], ['onion-2026-11-01-4x5.png', 'file'], ['onion-cache', 'directory'], ['WebKit', 'directory'], ['other.json', 'file']]);
  const g = {
    NATIVE: native, STORE: 's', DATA_FILE: 'old.json', saveTimer: null, saving: null, clearTimeout() {}, localStorage: { removeItem() {} },
    kv: { list: async p => [...keys].filter(k => k.startsWith(p) && !k.slice(p.length).includes('/')), del: async k => { keys.delete(k); } },
    FS: {
      readdir: async () => ({ files: [...cache].map(([name, type]) => ({ name, type })) }),
      deleteFile: async o => { if (o.directory === 'CACHE') cache.delete(o.path); }
    }
  };
  const wipe = new Function(...Object.keys(g), src.slice(at, end) + ';return wipeFiles;')(...Object.values(g));
  return { keys, cache, wipe, g };
}
test('存檔櫃清到一個不剩，包含 broken/ 與寫到一半的 .tmp', async () => {
  const r = run(false); await r.wipe(); assert.deepEqual([...r.keys], []);
});
test('iOS：暫存資料夾裡洋蔥自己匯出的檔一起刪，別的不碰', async () => {
  const r = run(true); await r.wipe(); assert.deepEqual([...r.cache.keys()], ['onion-cache', 'WebKit', 'other.json']);
});
test('暫存資料夾讀不到也照樣清完', async () => {
  const r = run(true); r.g.FS.readdir = async () => { throw new Error('x'); }; await r.wipe(); assert.equal(r.keys.size, 0);
});
