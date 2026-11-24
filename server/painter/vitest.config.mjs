import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // 測試用的小數字與假金鑰，跟部署的設定無關
      miniflare: { bindings: { OPENAI_API_KEY: 'fake-key', DAILY_PER_DEVICE: '1', DAILY_TOTAL: '3' } },
    }),
  ],
});
