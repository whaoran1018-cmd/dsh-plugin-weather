/**
 * MCP server test: drive bin/mcp-server.mjs over stdio exactly like a real
 * MCP client would (initialize → tools/list → tools/call), including both
 * accepted framings.
 *
 *   node test/mcp-test.mjs            # handshake + a live weather call
 *   node test/mcp-test.mjs --offline  # handshake/error paths only (CI-safe)
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OFFLINE = process.argv.includes('--offline')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const serverPath = join(root, 'bin', 'mcp-server.mjs')

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

const server = spawn(process.execPath, [serverPath], {
  stdio: ['pipe', 'pipe', 'pipe'],
  // Language comes from the environment on the MCP surface; zh keeps the
  // assertions below readable and exercises env-driven config.
  env: { ...process.env, WEATHER_LANG: 'zh' },
})

let stderr = ''
server.stderr.setEncoding('utf8')
server.stderr.on('data', (chunk) => {
  stderr += chunk
})

let buffer = ''
let stdoutNoise = 0
const pending = new Map()
server.stdout.setEncoding('utf8')
server.stdout.on('data', (chunk) => {
  buffer += chunk
  for (;;) {
    const newline = buffer.indexOf('\n')
    if (newline < 0) return
    const line = buffer.slice(0, newline)
    buffer = buffer.slice(newline + 1)
    if (!line.trim()) continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      stdoutNoise += 1
      failures.push(`non-JSON on stdout: ${line.slice(0, 120)}`)
      failed += 1
      continue
    }
    const resolve = pending.get(message.id)
    if (resolve) {
      pending.delete(message.id)
      resolve(message)
    }
  }
})

let nextId = 1
function request(method, params, { framed = false } = {}) {
  const id = nextId++
  const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params })
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 60000)
    pending.set(id, (message) => {
      clearTimeout(timer)
      resolve(message)
    })
  })
  server.stdin.write(framed ? `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}` : `${payload}\n`)
  return promise
}

function notify(method, params) {
  server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
}

console.log('\n=== MCP 握手与工具列举 ===')
const init = await request('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'mcp-test', version: '0.0.1' },
})
check('initialize: 有 result', Boolean(init.result), JSON.stringify(init.error ?? ''))
check('initialize: 回显协议版本', init.result?.protocolVersion === '2025-06-18', String(init.result?.protocolVersion))
check('initialize: 声明 tools 能力', Boolean(init.result?.capabilities?.tools))
check('initialize: serverInfo.name', init.result?.serverInfo?.name === 'dsh-plugin-weather', String(init.result?.serverInfo?.name))
check('initialize: 带 instructions', typeof init.result?.instructions === 'string' && init.result.instructions.length > 20)

notify('notifications/initialized')

const list = await request('tools/list', {})
const toolNames = (list.result?.tools ?? []).map((tool) => tool.name)
check('tools/list: 两个工具', list.result?.tools?.length === 2, toolNames.join(','))
check('tools/list: 含 get_weather', toolNames.includes('get_weather'))
check('tools/list: 含 get_weather_forecast', toolNames.includes('get_weather_forecast'))
const listed = list.result?.tools?.find((tool) => tool.name === 'get_weather')
check('tools/list: inputSchema 是 object', listed?.inputSchema?.type === 'object')
check('tools/list: 带 description', typeof listed?.description === 'string' && listed.description.length > 40)
check('tools/list: JSON 可序列化', (() => { try { JSON.parse(JSON.stringify(list.result)); return true } catch { return false } })())

console.log('\n=== Content-Length 分帧兼容 ===')
const pong = await request('ping', {}, { framed: true })
check('Content-Length 分帧的 ping 有回应', pong.result !== undefined, JSON.stringify(pong.error ?? ''))

console.log('\n=== 错误路径 ===')
const unknown = await request('tools/call', { name: 'nope', arguments: {} })
check('未知工具: isError=true', unknown.result?.isError === true)
check('未知工具: 有文字说明', /Unknown tool/.test(unknown.result?.content?.[0]?.text ?? ''))
const badParams = await request('tools/call', { arguments: {} })
check('缺 name: 返回 JSON-RPC 错误', badParams.error?.code === -32602, JSON.stringify(badParams.error ?? ''))
const badMethod = await request('does/not/exist', {})
check('未知方法: -32601', badMethod.error?.code === -32601, JSON.stringify(badMethod.error ?? ''))
const tooShort = await request('tools/call', { name: 'get_weather', arguments: { location: 'a' } })
check('非法地点: 返回文本而非崩溃', typeof tooShort.result?.content?.[0]?.text === 'string')

if (OFFLINE) {
  console.log('\n=== 真实天气调用 === 已跳过（--offline）')
} else {
  console.log('\n=== 真实天气调用 ===')
  const current = await request('tools/call', { name: 'get_weather', arguments: { location: '上海', days: 1 } })
  check('get_weather: isError=false', current.result?.isError === false, JSON.stringify(current.result?.content?.[0]?.text ?? '').slice(0, 160))
  check('get_weather: 摘要含温度', /温度/.test(current.result?.content?.[0]?.text ?? ''))
  const jsonBlock = current.result?.content?.[1]?.text
  let parsed = null
  try {
    parsed = JSON.parse(jsonBlock)
  } catch {
    /* handled below */
  }
  check('get_weather: 第二块是可用 JSON', parsed?.ok === true && typeof parsed?.current?.temperature === 'number')
  check('get_weather: 含空气质量', typeof parsed?.airQuality?.usAqi === 'number', String(parsed?.airQuality?.usAqi))

  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const hourly = await request('tools/call', {
    name: 'get_weather_forecast',
    arguments: { location: '上海', days: 3, date: tomorrow },
  })
  let forecast = null
  try {
    forecast = JSON.parse(hourly.result?.content?.[1]?.text ?? '')
  } catch {
    /* handled below */
  }
  check('get_weather_forecast: date 参数生效', forecast?.hourlyDate === tomorrow, String(forecast?.hourlyDate))
  check('get_weather_forecast: 该日逐时 24 条', forecast?.hourly?.length === 24, String(forecast?.hourly?.length))
}

server.kill()
check('stdout 只含合法 JSON-RPC（日志都在 stderr）', stdoutNoise === 0, String(stdoutNoise))
check('服务端启动日志在 stderr', stderr.includes('ready:'), stderr.split('\n')[0])

console.log(`\n=== 结果：${passed} 通过 / ${failed} 失败 ===`)
if (failures.length) {
  console.log('\n失败明细：')
  for (const item of failures) console.log(`  · ${item}`)
}
process.exit(failed ? 1 : 0)
