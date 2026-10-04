/**
 * Regenerate the checked-in schema files under schema/ from the live tool
 * definitions, so framework users can just `require()` a JSON file.
 *
 *   node tools/export-schemas.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTools } from '../lib/harness.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'schema')
mkdirSync(outDir, { recursive: true })

const tools = loadTools()

const openai = tools.map((tool) => ({
  type: 'function',
  function: { name: tool.name, description: tool.description, parameters: tool.parameters },
}))

const anthropic = tools.map((tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.parameters,
}))

writeFileSync(join(outDir, 'openai-tools.json'), `${JSON.stringify(openai, null, 2)}\n`, 'utf8')
writeFileSync(join(outDir, 'anthropic-tools.json'), `${JSON.stringify(anthropic, null, 2)}\n`, 'utf8')
process.stdout.write(
  `wrote schema/openai-tools.json (${openai.length} tools)\nwrote schema/anthropic-tools.json (${anthropic.length} tools)\n`,
)
