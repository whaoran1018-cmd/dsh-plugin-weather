#!/usr/bin/env node
/**
 * dsh-plugin-weather — one-shot CLI.
 *
 * For agents and scripts that can only run shell commands (Aider, Codex
 * `--exec`, Claude Code Bash tool, CI jobs, cron, you at 2am).
 *
 *   node bin/cli.mjs 上海
 *   node bin/cli.mjs 上海 --days 7
 *   node bin/cli.mjs "New York" --units imperial --days 3
 *   node bin/cli.mjs --lat 31.23 --lon 121.47 --date 2026-10-07
 *   node bin/cli.mjs 雅加达 --json | jq '.airQuality.usAqi'
 *
 * Flags:
 *   --days N            daily rows to include (0-16; get_weather default 3)
 *   --date YYYY-MM-DD   hourly rows for exactly that local day
 *   --hourly            hourly rows for the next 48 h
 *   --units metric|imperial
 *   --lang zh|en
 *   --no-air            skip the air-quality block
 *   --json              print the full JSON result instead of the summary
 *   --default PLACE     default location used when none is given
 *   --version, --help
 */
import { LANGUAGES } from '../lib/i18n.js'
import { loadTools, resultText } from '../lib/harness.js'

const TOOL_FOR_DATE = 'get_weather_forecast'

function usage() {
  const text = [
    'dsh-plugin-weather — global weather, forecast and air quality (Open-Meteo, no API key)',
    '',
    'usage: dsh-weather <location | --lat N --lon N> [options]',
    '',
    '  --days N            daily rows (0-16)',
    '  --date YYYY-MM-DD   hourly rows for one local day',
    '  --hourly            hourly rows for the next 48 h',
    '  --units metric|imperial',
    '  --lang CODE         summary language: ' + LANGUAGES.join(', '),
    '  --no-air            skip air quality',
    '  --json              print raw JSON',
    '  --default PLACE     fallback location',
    '  --version | --help',
    '',
    'examples:',
    '  dsh-weather 上海 --days 7',
    '  dsh-weather "New York" --units imperial --json',
    '  dsh-weather --lat 31.23 --lon 121.47 --date 2026-10-07',
  ].join('\n')
  process.stdout.write(`${text}\n`)
}

function parseArgv(argv) {
  const args = { location: undefined, flags: {}, errors: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('-')) {
      if (args.location === undefined) args.location = token
      else args.errors.push(`unexpected extra argument: ${token}`)
      continue
    }
    const [flag, inlineValue] = token.includes('=') ? token.split(/=(.*)/s, 2) : [token, undefined]
    const next = () => (inlineValue !== undefined ? inlineValue : argv[++index])
    switch (flag) {
      case '-h':
      case '--help':
        args.flags.help = true
        break
      case '-v':
      case '--version':
        args.flags.version = true
        break
      case '--json':
        args.flags.json = true
        break
      case '--hourly':
        args.flags.hourly = true
        break
      case '--no-air':
        args.flags.noAir = true
        break
      case '--days':
        args.flags.days = Number(next())
        break
      case '--date':
        args.flags.date = next()
        break
      case '--units':
        args.flags.units = next()
        break
      case '--lang':
        args.flags.lang = next()
        break
      case '--lat':
        args.flags.lat = Number(next())
        break
      case '--lon':
        args.flags.lon = Number(next())
        break
      case '--default':
        args.flags.defaultLocation = next()
        break
      default:
        args.errors.push(`unknown flag: ${flag}`)
    }
  }
  return args
}

const { location, flags, errors } = parseArgv(process.argv.slice(2))

if (flags.help) {
  usage()
  process.exit(0)
}
if (flags.version) {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const { dirname, join } = await import('node:path')
  const pkg = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
  )
  process.stdout.write(`${pkg.name} ${pkg.version}\n`)
  process.exit(0)
}
if (errors.length) {
  process.stderr.write(`${errors.join('\n')}\n\n`)
  usage()
  process.exit(2)
}
if (location === undefined && !(Number.isFinite(flags.lat) && Number.isFinite(flags.lon))) {
  process.stderr.write('missing location: pass a city name, "lat,lon", or --lat/--lon\n\n')
  usage()
  process.exit(2)
}

const config = {}
if (flags.lang) config.language = flags.lang
if (flags.units) config.units = flags.units
if (flags.defaultLocation) config.defaultLocation = flags.defaultLocation

const tools = loadTools(config)
const byName = new Map(tools.map((tool) => [tool.name, tool]))

const wantsForecast =
  flags.date !== undefined || flags.hourly === true || (Number.isFinite(flags.days) && flags.days > 3)
const tool = byName.get(wantsForecast ? TOOL_FOR_DATE : 'get_weather') ?? tools[0]

const args = {}
if (location !== undefined) args.location = location
if (Number.isFinite(flags.lat)) args.latitude = flags.lat
if (Number.isFinite(flags.lon)) args.longitude = flags.lon
if (flags.units) args.units = flags.units
if (Number.isFinite(flags.days)) args.days = flags.days
if (flags.date !== undefined) args.date = flags.date
if (flags.hourly) args.includeHourly = true
if (flags.noAir) args.includeAirQuality = false

let result
try {
  result = await tool.execute(args, {})
} catch (error) {
  process.stderr.write(`${error?.message ?? error}\n`)
  process.exit(1)
}

if (flags.json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} else {
  process.stdout.write(`${resultText(result)}\n`)
}
process.exit(result && result.ok === false ? 1 : 0)
