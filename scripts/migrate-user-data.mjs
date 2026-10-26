#!/usr/bin/env node
// 把单用户时代的数据目录迁到 data/users/<userId>/ 下。
// 用法：
//   node scripts/migrate-user-data.mjs --user-id u_xxxxxxxx          # 预演
//   node scripts/migrate-user-data.mjs --user-id u_xxxxxxxx --apply # 执行
import { access, cp, mkdir, readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const userId = arg('user-id')
const apply = process.argv.includes('--apply')
if (!userId || !/^[A-Za-z0-9_-]{3,40}$/.test(userId)) {
  console.error('用法：node scripts/migrate-user-data.mjs --user-id u_xxxxxxxx [--apply]')
  process.exit(1)
}

const dataDir = process.env.HYS_DATA_DIR
  ? path.resolve(process.env.HYS_DATA_DIR)
  : path.resolve(process.cwd(), 'data')
const target = path.join(dataDir, 'users', userId)
const ENTRIES = ['topics', 'topics.json', 'preferences.json']

async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function move(src, dest) {
  try {
    await rename(src, dest)
  } catch {
    await cp(src, dest, { recursive: true, force: false, errorOnExist: true })
    await rm(src, { recursive: true, force: true })
  }
}

async function main() {
  if (!(await exists(dataDir))) {
    console.error(`数据目录不存在：${dataDir}`)
    process.exit(1)
  }
  if (await exists(target)) {
    const entries = await readdir(target)
    if (entries.length > 0) {
      console.error(`目标目录已存在且非空，拒绝覆盖：${target}`)
      process.exit(1)
    }
  }
  const plan = []
  for (const name of ENTRIES) {
    const src = path.join(dataDir, name)
    if (await exists(src)) plan.push({ name, src, dest: path.join(target, name) })
  }
  if (plan.length === 0) {
    console.log('没有需要迁移的数据（topics / topics.json / preferences.json 均不存在）')
    return
  }
  console.log(`数据目录：${dataDir}`)
  console.log(`目标用户：${userId}`)
  for (const item of plan) console.log(`  ${item.name} -> users/${userId}/${item.name}`)
  if (!apply) {
    console.log('\n当前为预演模式，确认无误后加 --apply 执行。')
    console.log('注意：data/settings.json 含旧模型 key，公网版改从 .env 读取，迁移后请手动删除。')
    return
  }
  await mkdir(target, { recursive: true })
  for (const item of plan) {
    await move(item.src, item.dest)
    console.log(`已迁移 ${item.name}`)
  }
  console.log('\n完成。若 data/settings.json 仍在，请确认 .env 已配置后删除它。')
}

main().catch((err) => {
  console.error('迁移失败：', err)
  process.exit(1)
})