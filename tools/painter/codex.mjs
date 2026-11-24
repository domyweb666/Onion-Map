// 叫這台電腦的 Codex CLI 畫一張圖。
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sniff } from './images.mjs';

const IS_WIN = process.platform === 'win32';
export const MODEL = (process.env.CODEX_MODEL || '').trim() || 'gpt-5.6-terra';
const TIMEOUT_MS = Number(process.env.ONION_TIMEOUT_MS) || 10 * 60 * 1000;

// message 是可以給手機看的話，detail 只印在終端機
export class PaintError extends Error {
  constructor(message, detail = '') {
    super(message);
    this.detail = detail;
  }
}

// ---------- 找 codex ----------
function whereAll(name) {
  try {
    const out = execFileSync(IS_WIN ? 'where' : 'which', IS_WIN ? [name] : ['-a', name], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// Windows 上 npm 裝的是 codex.cmd，Node 不開 shell 就跑不動 .cmd，
// 所以找到它背後的 codex.js 直接用 node 跑，整條路都不經過 shell。找不到才試 codex.exe。
export function findCodex() {
  const found = whereAll('codex');
  if (!IS_WIN) return found[0] ? { file: found[0], pre: [] } : null;
  for (const cmd of found.filter((p) => p.toLowerCase().endsWith('.cmd'))) {
    const dir = path.dirname(cmd);
    let js = '';
    try {
      const m = fs.readFileSync(cmd, 'utf8').match(/%dp0%\\([^"]+?\.js)/i);
      if (m) js = path.join(dir, m[1]);
    } catch {
      /* 讀不到就用下面的預設位置 */
    }
    if (!js || !fs.existsSync(js)) js = path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (fs.existsSync(js)) {
      const localNode = path.join(dir, 'node.exe');
      return { file: fs.existsSync(localNode) ? localNode : process.execPath, pre: [js] };
    }
  }
  const exe = found.find((p) => p.toLowerCase().endsWith('.exe'));
  return exe ? { file: exe, pre: [] } : null;
}

// 只帶 CLI 跑得起來、找得到登入、連得出去要的環境變數，各家 API 金鑰都不給
const ENV_KEEP = new Set(
  (
    'PATH PATHEXT SYSTEMROOT SYSTEMDRIVE WINDIR COMSPEC OS PROCESSOR_ARCHITECTURE PROGRAMDATA PROGRAMFILES PROGRAMFILES(X86) PROGRAMW6432 ' +
    'HOME USERPROFILE HOMEDRIVE HOMEPATH APPDATA LOCALAPPDATA PUBLIC USER USERNAME USERDOMAIN LOGNAME SHELL TEMP TMP TMPDIR LANG LC_ALL LC_CTYPE TZ ' +
    'XDG_CONFIG_HOME XDG_DATA_HOME HTTP_PROXY HTTPS_PROXY NO_PROXY NODE_EXTRA_CA_CERTS NODE_USE_SYSTEM_CA CODEX_HOME'
  ).split(' '),
);

function childEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (ENV_KEEP.has(k.toUpperCase())) env[k] = v;
  }
  return env;
}

// 砍整棵程序樹：codex.js 底下還有真正的 codex.exe，只砍外面那層它會留著繼續吃額度
export function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (IS_WIN && child.pid) {
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      return;
    } catch {
      /* 退回下面 */
    }
  }
  if (!IS_WIN && child.pid) {
    try {
      process.kill(-child.pid, 'SIGKILL');
      return;
    } catch {
      /* 退回下面 */
    }
  }
  child.kill('SIGKILL');
}

function start(codex, args, cwd) {
  return spawn(codex.file, [...codex.pre, ...args], {
    cwd,
    env: childEnv(),
    windowsHide: true,
    detached: !IS_WIN,
    // stdin 一定要關掉，不然 codex exec 會一直等人打字
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function codexVersion(codex) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = start(codex, ['--version'], os.tmpdir());
    } catch {
      resolve('');
      return;
    }
    const timer = setTimeout(() => killTree(child), 20 * 1000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.resume();
    child.on('error', () => (clearTimeout(timer), resolve('')));
    child.on('close', (code) => (clearTimeout(timer), resolve(code === 0 ? out.trim() : '')));
  });
}

// ---------- 畫一張 ----------
function wrap(prompt) {
  return `請用內建的 image generation 工具，以附上的這張圖為參考，生一張新圖。
規矩：只生一張。一定要用 image generation 工具畫，不要寫程式畫、不要用程式處理原圖。直式 2:3，優先 1024×1536。
生完就結束，不用搬檔案、不用改尺寸、不用再檢查，回「好」就好。

${prompt}`;
}

// 把常見的失敗講成人話；認不出來的就叫人去看終端機
function explain(text, code) {
  if (/usage limit|rate limit|quota|too many requests|\b429\b/i.test(text)) return 'ChatGPT 的畫圖額度用完了，過一陣子再畫';
  if (/not logged in|please log ?in|codex login|401 unauthorized|token.{0,20}expired/i.test(text)) {
    return '電腦上的 Codex 沒有登入，在電腦打開終端機打 codex login';
  }
  if (/model_not_found|model .{0,60}(not supported|not exist)/i.test(text)) return '這個帳號不能用現在設定的模型，換一個 CODEX_MODEL 再開';
  if (code !== 0) return '電腦上的 Codex 畫到一半停了，細節看電腦的終端機';
  return 'Codex 跑完了可是沒有畫出圖，再試一次';
}

function newestImage(dir, since, skip = '') {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const list = [];
  for (const name of names) {
    if (name === skip || !/\.(png|jpe?g)$/i.test(name)) continue;
    const file = path.join(dir, name);
    const st = fs.statSync(file);
    if (st.isFile() && st.mtimeMs >= since) list.push({ file, t: st.mtimeMs });
  }
  list.sort((a, b) => b.t - a.t);
  for (const { file } of list) {
    const buf = fs.readFileSync(file);
    if (sniff(buf)) return buf;
  }
  return null;
}

// dir 是這張圖專用的工作資料夾（英文路徑），input 是裡面的底稿檔名。
// onChild 會拿到程序，外面要取消時拿去砍。
export function paintWithCodex({ codex, dir, input, prompt, onChild, log = () => {} }) {
  return new Promise((resolve, reject) => {
    const args = ['exec', '-m', MODEL, '--skip-git-repo-check', '-s', 'workspace-write', '-C', dir];
    // -i 會把後面的字全部當成圖檔，所以指令要排在它前面
    args.push(wrap(prompt), '-i', path.join(dir, input));
    const since = Date.now() - 2000;
    let child;
    try {
      child = start(codex, args, dir);
    } catch (e) {
      reject(new PaintError('電腦上的 Codex 開不起來', e.message));
      return;
    }
    onChild(child);
    let out = '';
    let timedOut = false;
    const keep = (d) => {
      out += d;
      // session id 印在最前面，太長的時候砍中間
      if (out.length > 400000) out = out.slice(0, 20000) + out.slice(-200000);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, TIMEOUT_MS);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new PaintError('電腦上的 Codex 開不起來', e.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const session = (out.match(/session id:\s*([0-9a-f]{8}-[0-9a-f-]{27})/i) || [])[1] || '';
        if (session) log(`Codex session ${session}`);
        let buf = newestImage(dir, since, input);
        if (!buf && session) {
          const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
          buf = newestImage(path.join(home, 'generated_images', session), since);
        }
        // 超時但圖已經出來了，照樣算數
        if (buf) resolve(buf);
        else if (timedOut) reject(new PaintError('畫太久了，先停下來，再試一次', out.trim().slice(-600)));
        else reject(new PaintError(explain(out, code), `codex 結束碼 ${code}：${out.trim().slice(-600)}`));
      } catch (e) {
        reject(new PaintError('畫好的圖讀不出來，再試一次', e.message));
      }
    });
  });
}
