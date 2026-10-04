#!/usr/bin/env node
/**
 * dsh-plugin-weather — print the tool schemas in another framework's shape.
 *
 *   node bin/schemas.mjs openai      # Chat Completions / Responses "tools"
 *   node bin/schemas.mjs anthropic   # Messages API "tools"
 *   node bin/schemas.mjs mcp         # MCP tools/list result
 *   node bin/schemas.mjs dsh         # what the DSH plugin registers
 *
 * The schemas come from the very same definitions the plugin registers, so
 * they can never drift from the running tools.
 */
import { loadTools } from '../lib/harness.js'

const format = (process.argv[2] ?? 'openai').toLowerCase()
const tools = loadTools()

function openai() {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

function anthropic() {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }))
}

function mcp() {
  return { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.parameters })) }
}

function dsh() {
  return tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }))
}

const output =
  format === 'anthropic' ? anthropic() : format === 'mcp' ? mcp() : format === 'dsh' ? dsh() : openai()

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
