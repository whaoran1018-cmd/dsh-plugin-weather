#!/usr/bin/env node
/**
 * dsh-plugin-weather — MCP server (stdio).
 *
 * Works with any MCP-capable agent: Claude Code, Codex CLI, Cursor, Windsurf,
 * Gemini CLI, Cline, ChatGPT desktop, Zed, and DSH itself.
 *
 *   node bin/mcp-server.mjs
 *
 * Protocol notes:
 *  - stdout carries newline-delimited JSON-RPC 2.0 only; logs go to stderr.
 *  - Both framings are accepted on stdin: newline-delimited JSON (MCP stdio)
 *    and `Content-Length:` headers (LSP-style, used by a few older clients).
 *  - Tools are the exact same definitions the DSH plugin registers
 *    (lib/harness.js), so behaviour cannot drift between surfaces.
 *
 * Environment:
 *   WEATHER_DEFAULT_LOCATION, WEATHER_LANG, WEATHER_UNITS, WEATHER_PROVIDER
 *   WEATHER_TOOL_PREFIX   optional prefix, e.g. "weather_" (default: none)
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LANGUAGES } from '../lib/i18n.js'
import { loadTools, resultBlocks } from '../lib/harness.js'

const PREFIX = process.env.WEATHER_TOOL_PREFIX ?? ''
const PROTOCOL_FALLBACK = '2025-06-18'
const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'))

const definitions = loadTools()
const byName = new Map(definitions.map((definition) => [PREFIX + definition.name, definition]))

function log(...args) {
  process.stderr.write(`[dsh-plugin-weather] ${args.join(' ')}\n`)
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function replyError(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } })
}

function toolList() {
  return [...byName.entries()].map(([name, definition]) => ({
    name,
    description: definition.description,
    inputSchema: definition.parameters,
  }))
}

async function callTool(name, args, signal) {
  const definition = byName.get(name)
  if (!definition) {
    return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] }
  }
  try {
    const value = await definition.execute(args ?? {}, { signal })
    const isError = Boolean(value && typeof value === 'object' && value.ok === false)
    return { content: resultBlocks(value), isError }
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Tool ${name} failed: ${error?.message ?? String(error)}` }],
    }
  }
}

async function handle(message) {
  const { id, method, params } = message
  const isNotification = id === undefined || id === null

  switch (method) {
    case 'initialize': {
      if (isNotification) return
      const requested = params?.protocolVersion
      reply(id, {
        protocolVersion: typeof requested === 'string' && requested ? requested : PROTOCOL_FALLBACK,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'dsh-plugin-weather', version: pkg.version },
        instructions:
          'Global weather and air quality. Use get_weather for current conditions (3-day outlook by ' +
          'default) and get_weather_forecast for 1-16 day forecasts; pass date="YYYY-MM-DD" for one day’s hourly rows. ' +
          `The summary language follows WEATHER_LANG (${LANGUAGES.join(', ')}; default en) or the per-call "language" argument.`,
      })
      return
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
    case 'initialized':
      return
    case 'ping':
      if (!isNotification) reply(id, {})
      return
    case 'tools/list':
      if (!isNotification) reply(id, { tools: toolList() })
      return
    case 'tools/call': {
      if (isNotification) return
      const name = params?.name
      if (typeof name !== 'string') {
        replyError(id, -32602, 'Invalid params: "name" is required')
        return
      }
      const result = await callTool(name, params?.arguments)
      reply(id, result)
      return
    }
    default:
      if (!isNotification) replyError(id, -32601, `Method not found: ${method}`)
  }
}

function handleLine(line) {
  const trimmed = line.trim()
  if (!trimmed) return
  let message
  try {
    message = JSON.parse(trimmed)
  } catch {
    replyError(null, -32700, 'Parse error')
    return
  }
  handle(message).catch((error) => {
    log(`handler error: ${error?.stack ?? error}`)
    if (message?.id !== undefined) replyError(message.id, -32603, `Internal error: ${error?.message ?? error}`)
  })
}

// --- stdin: support newline-delimited JSON and Content-Length framing --------
let buffer = ''
let expected = null

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  for (;;) {
    if (expected === null) {
      const headerMatch = /^Content-Length:\s*(\d+)\r?\n/i.exec(buffer)
      if (headerMatch) {
        const blank = buffer.indexOf('\r\n\r\n') >= 0 ? buffer.indexOf('\r\n\r\n') + 4 : buffer.indexOf('\n\n') + 2
        if (blank <= 1) return // header incomplete
        expected = Number(headerMatch[1])
        buffer = buffer.slice(blank)
        continue
      }
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      handleLine(line)
      continue
    }
    if (Buffer.byteLength(buffer, 'utf8') < expected) return
    // Read exactly `expected` bytes, in characters-safe way.
    let bytes = 0
    let cut = 0
    for (const char of buffer) {
      const charBytes = Buffer.byteLength(char, 'utf8')
      if (bytes + charBytes > expected) break
      bytes += charBytes
      cut += char.length
    }
    const body = buffer.slice(0, cut)
    buffer = buffer.slice(cut)
    expected = null
    handleLine(body)
  }
})

process.stdin.on('end', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))

log(`ready: ${[...byName.keys()].join(', ')}`)
