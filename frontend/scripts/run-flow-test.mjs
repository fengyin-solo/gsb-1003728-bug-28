// 行为验证入口：打包 scripts/flow-test.ts 后分别跑「主流程」和「旧数据兼容」两个场景。
// 用法：npm run test:flow
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outfile = join(root, 'node_modules', '.flow-test.mjs')

await build({
  entryPoints: [join(root, 'scripts', 'flow-test.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  alias: { '@': join(root, 'src') },
  outfile,
  logLevel: 'silent',
})

let failed = 0
for (const [label, arg] of [['主流程', 'main'], ['旧数据兼容', 'legacy']]) {
  console.log(`\n—— ${label} ——`)
  const run = spawnSync(process.execPath, [outfile, arg], { stdio: 'inherit' })
  if (run.status !== 0) {
    failed = 1
  }
}
process.exit(failed)
