// 列出帳號下還開著的 Limrun 模擬器（只看不動）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Limrun from '@limrun/api';
const cfg = readFileSync(join(process.env.USERPROFILE ?? process.env.HOME, '.lim', 'config.yaml'), 'utf8');
const lim = new Limrun({ apiKey: process.env.LIM_API_KEY ?? (cfg.match(/api-key:\s*(\S+)/) ?? [])[1] });
let n = 0;
for await (const i of lim.iosInstances.list()) {
  if (i.status?.state === 'terminated') continue;
  n++;
  const created = i.metadata?.createdAt ? Math.round((Date.now() - new Date(i.metadata.createdAt)) / 60000) + ' 分鐘前開' : '';
  console.log(i.metadata?.id, i.status?.state, i.metadata?.displayName ?? '', JSON.stringify(i.metadata?.labels ?? {}), created, 'hard=' + (i.spec?.hardTimeout ?? '?'), 'idle=' + (i.spec?.inactivityTimeout ?? '?'));
}
console.log(n ? n + ' 台開著' : '沒有機器開著');
