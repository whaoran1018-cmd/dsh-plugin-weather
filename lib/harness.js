/**
 * Shared loader: get this plugin's tool definitions without DSH.
 *
 * `lib/index.js` registers its tools through the injected `tools` service.
 * Any other surface (MCP server, one-shot CLI, schema exporters) can reuse the
 * exact same definitions by passing a tiny mock context, which keeps a single
 * source of truth for names, descriptions, parameter schemas and behaviour.
 *
 *   import { loadTools } from '../lib/harness.js'
 *   const [getWeather, getForecast] = loadTools()
 *   await getWeather.execute({ location: '上海' }, {})
 */
import { apply, Config } from './index.js'

/** Merge env overrides into the plugin config without requiring schemastery. */
function baseConfig(overrides = {}) {
  const env = {
    defaultLocation: process.env.WEATHER_DEFAULT_LOCATION,
    language: process.env.WEATHER_LANG,
    units: process.env.WEATHER_UNITS,
    provider: process.env.WEATHER_PROVIDER,
  }
  const merged = {}
  for (const [key, value] of Object.entries({ ...env, ...overrides })) {
    if (value !== undefined && value !== null && value !== '') merged[key] = value
  }
  if (typeof Config === 'function') return Config(merged)
  return merged
}

/**
 * @param {Record<string, unknown>} [overrides] config overrides (same keys as the DSH plugin config)
 * @returns {Array<{name: string, description: string, parameters: Record<string, unknown>,
 *   execute(args: unknown, exec: {signal?: AbortSignal}): Promise<unknown>}>}
 */
export function loadTools(overrides) {
  const definitions = []
  const ctx = {
    tools: {
      register(definition) {
        definitions.push(definition)
        return () => {}
      },
    },
  }
  apply(ctx, baseConfig(overrides))
  return definitions
}

/** Look one tool up by name; throws with the available names when unknown. */
export function loadTool(name, overrides) {
  const definitions = loadTools(overrides)
  const found = definitions.find((definition) => definition.name === name)
  if (!found) {
    throw new Error(`unknown tool "${name}"; available: ${definitions.map((d) => d.name).join(', ')}`)
  }
  return found
}

/** Text a surface should show a human/model for one tool result. */
export function resultText(result) {
  if (result && typeof result === 'object') {
    if (typeof result.summary === 'string' && result.summary) return result.summary
    if (result.ok === false && typeof result.message === 'string') return `⚠️ ${result.message}`
  }
  return JSON.stringify(result, null, 2)
}

/** Tool result plus the machine-readable payload, as MCP content blocks. */
export function resultBlocks(result) {
  const { summary, ...rest } = result && typeof result === 'object' ? result : { value: result }
  return [
    { type: 'text', text: resultText(result) },
    { type: 'text', text: JSON.stringify(rest, null, 2) },
  ]
}
