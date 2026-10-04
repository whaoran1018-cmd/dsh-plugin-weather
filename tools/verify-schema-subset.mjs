/**
 * Validate this plugin's tool schemas with DSH's REAL validator.
 *
 *   node tools/verify-schema-subset.mjs
 *   DSH_ASAR=/path/to/app.asar node tools/verify-schema-subset.mjs
 *   node tools/verify-schema-subset.mjs --strict   # fail when DSH is not found
 *
 * Why this exists: DSH only accepts a narrow JSON Schema subset for tool
 * parameters and outputs —
 *   type / oneOf / properties / required / additionalProperties / items /
 *   enum / const  +  description / title / default / examples
 * with `oneOf` needing at least two branches. Anything else (`minimum`,
 * `pattern`, …) makes the whole plugin row fail to activate with
 * `unsupported JSON schema: …`, which is easy to miss locally.
 *
 * The script extracts the json-schema region straight out of the installed
 * `@deepseek-ai/dsh-tools/lib/index.js` inside app.asar and runs it, so the
 * verdict matches what the host does at startup. When no DSH install can be
 * found (plain CI checkout, another OS), it skips unless --strict is given.
 */
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const STRICT = process.argv.includes('--strict')

function findAsar() {
  const candidates = [
    process.env.DSH_ASAR,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources', 'app.asar'),
    '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar',
    join(homedir(), 'Applications', 'DeepSeek Harness.app', 'Contents', 'Resources', 'app.asar'),
    join(homedir(), '.dsh', 'runtime', 'app.asar'),
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate))
}

const asarPath = findAsar()
if (!asarPath) {
  console.log('⚠️  没找到 DeepSeek Harness 的 app.asar，跳过真实校验器检查。')
  console.log('   需要时用 DSH_ASAR=<path> 指定，或加 --strict 让其失败。')
  process.exit(STRICT ? 1 : 0)
}

/** Extract one file out of an asar archive (8-byte header + pickled JSON header + data). */
function extractFromAsar(file, innerPath, outPath) {
  const buffer = readFileSync(file)
  const headerSize = buffer.readUInt32LE(4)
  const jsonLength = buffer.readUInt32LE(12)
  const header = JSON.parse(buffer.toString('utf8', 16, 16 + jsonLength))
  let node = header
  for (const part of innerPath.split('/')) {
    node = node.files?.[part]
    if (!node) throw new Error(`asar 中找不到 ${innerPath}（在 ${part} 处中断）`)
  }
  const start = 8 + headerSize + Number(node.offset)
  const text = buffer.toString('utf8', start, start + node.size)
  writeFileSync(outPath, text)
  return text
}

const workdir = mkdtempSync(join(tmpdir(), 'dsh-weather-verify-'))
const full = extractFromAsar(
  asarPath,
  'dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
  join(workdir, 'dsh-tools-index.js'),
)

// Take only the json-schema region (self-contained) and stub its outer imports.
const lines = full.split('\n')
const start = lines.findIndex((line) => line.includes('#region lib/types/json-schema.js'))
const end = lines.findIndex((line, index) => index > start && line.trim() === '//#endregion')
if (start < 0 || end < 0) throw new Error('未能在 dsh-tools 中找到 json-schema 区域')

const stubs = `
class HarnessError extends Error {
  constructor(message, code) { super(message); this.code = code; this.name = 'HarnessError' }
}
const assertNever = (value, name) => { throw new Error('unexpected ' + name + ': ' + String(value)) }
const isJsonValue = (value) => {
  const walk = (node) => {
    if (node === null || typeof node === 'string' || typeof node === 'boolean') return true
    if (typeof node === 'number') return Number.isFinite(node)
    if (typeof node !== 'object') return false
    if (Array.isArray(node)) return node.every(walk)
    return Object.keys(node).every((key) => walk(node[key]))
  }
  try { return walk(value) } catch { return false }
}
const deepFreeze = (value) => value
const snapshotJsonValue = (value) => value
`
const validatorPath = join(workdir, 'real-validator.mjs')
writeFileSync(
  validatorPath,
  `${stubs}\n${lines.slice(start, end).join('\n')}\nexport { assertSupportedJsonSchema }\n`,
  'utf8',
)

const { assertSupportedJsonSchema } = await import(pathToFileURL(validatorPath).href)
const entry = join(resolve(fileURLToPath(new URL('..', import.meta.url))), 'lib', 'index.js')
const plugin = await import(pathToFileURL(entry).href)

const registered = []
plugin.apply(
  { tools: { register: (definition) => (registered.push(definition), () => {}) } },
  plugin.Config ? plugin.Config({}) : {},
)

let failed = 0
for (const tool of registered) {
  for (const [label, schema] of [
    ['parameters', tool.parameters],
    ['output.schema', tool.output?.schema],
  ]) {
    try {
      assertSupportedJsonSchema(schema)
      console.log(`✅ ${tool.name}.${label}`)
    } catch (error) {
      failed += 1
      console.log(`❌ ${tool.name}.${label}\n   ${error.message}`)
    }
  }
}
console.log(
  failed
    ? `\n=== 失败 ${failed} 项（宿主会拒绝激活）===`
    : `\n=== 全部通过 DSH 真实校验器（${asarPath}） ===`,
)
process.exit(failed ? 1 : 0)
