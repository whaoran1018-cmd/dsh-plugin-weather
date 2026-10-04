/**
 * CLI surface test: bin/cli.mjs must work for agents that only run commands.
 *
 *   node test/cli-test.mjs            # includes a live call
 *   node test/cli-test.mjs --offline  # help/version/error paths only
 */
import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OFFLINE = process.argv.includes('--offline')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'bin', 'cli.mjs')

let passed = 0
let failed = 0
const failures = []

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✅ ${label}`)
  } else {
    failed += 1
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function run(args) {
  return new Promise((resolve) => {
    // 120 s: a CI runner talking to a rate-limited free API can be far slower
    // than a laptop; the per-request timeout inside the plugin is still 15 s.
    execFile(process.execPath, [cli, ...args], { timeout: 120000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, stdout, stderr, timedOut: error?.killed === true })
    })
  })
}

console.log('\n=== 参数与错误路径 ===')
const help = await run(['--help'])
check('--help: 退出码 0', help.code === 0, String(help.code))
check('--help: 打印用法', /usage: dsh-weather/.test(help.stdout))
const version = await run(['--version'])
check('--version: 打印包名与版本', /^dsh-plugin-weather \d+\.\d+\.\d+/.test(version.stdout.trim()), version.stdout.trim())
const noLocation = await run([])
check('缺地点: 退出码 2', noLocation.code === 2, String(noLocation.code))
check('缺地点: 提示怎么给地点', /missing location/.test(noLocation.stderr))
const badFlag = await run(['上海', '--nope'])
check('未知参数: 退出码 2', badFlag.code === 2, String(badFlag.code))
const badPlace = await run(['zzzzqqqxxyy', '--json'])
check('找不到地点: 退出码 1', badPlace.code === 1, String(badPlace.code))
check('找不到地点: 输出可读信息', /找不到|Failed|geocod/i.test(badPlace.stdout + badPlace.stderr))

if (OFFLINE) {
  console.log('\n=== 真实调用 === 已跳过（--offline）')
} else {
  console.log('\n=== 真实调用 ===')
  const json = await run(['--lat', '31.23', '--lon', '121.47', '--days', '2', '--json'])
  let parsed = null
  try {
    parsed = JSON.parse(json.stdout)
  } catch {
    /* handled below */
  }
  check('坐标 + --json: 退出码 0', json.code === 0, String(json.code))
  check('坐标 + --json: ok=true', parsed?.ok === true, json.stdout.slice(0, 160))
  check('坐标 + --json: 含温度/湿度/紫外线/日出', typeof parsed?.current?.temperature === 'number' && typeof parsed?.current?.uvIndex === 'number' && /^\d{2}:\d{2}$/.test(parsed?.current?.sunrise ?? ''))
  check('坐标 + --json: 含空气质量', typeof parsed?.airQuality?.usAqi === 'number')
  check('坐标 + --json: 2 天逐日', parsed?.daily?.length === 2, String(parsed?.daily?.length))

  const text = await run(['上海', '--days', '1'])
  check('默认输出人类可读摘要', /温度/.test(text.stdout) && /日出/.test(text.stdout))

  const imperial = await run(['Shanghai', '--units', 'imperial', '--days', '1', '--json'])
  let imp = null
  try {
    imp = JSON.parse(imperial.stdout)
  } catch {
    /* handled below */
  }
  check('--units imperial: 单位为 °F', imp?.unitLabels?.temperature === '°F', String(imp?.unitLabels?.temperature))

  const dated = await run(['上海', '--date', new Date(Date.now() + 86400000).toISOString().slice(0, 10), '--json'])
  let day = null
  try {
    day = JSON.parse(dated.stdout)
  } catch {
    /* handled below */
  }
  check(
    '--date: 回该日 24 小时逐时',
    day?.hourly?.length === 24,
    dated.timedOut ? '上游超时/限速（120s），非插件问题' : String(day?.hourly?.length),
  )
}

console.log(`\n=== 结果：${passed} 通过 / ${failed} 失败 ===`)
if (failures.length) {
  console.log('\n失败明细：')
  for (const item of failures) console.log(`  · ${item}`)
}
process.exit(failed ? 1 : 0)
