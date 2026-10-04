# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-10-05

### Added
- **Nine summary languages**: 中文 (zh), English (en), Español (es), 日本語 (ja), 한국어 (ko), Português (pt),
  Italiano (it), Français (fr), Deutsch (de) — weather descriptions, all 16 compass points, UV levels,
  US/EU AQI categories, weekdays, every label, note and error message.
- `lib/i18n.js` + `lib/locales/<code>.js` catalogs, with an English fallback for anything missing and
  alias resolution (`zh-CN`, `pt_BR`, `EN`, …).
- A per-call `language` argument on both tools, so one request can override the configured language; the MCP
  surface reads `WEATHER_LANG` and the CLI accepts `--lang`.
- `test/i18n-test.mjs`: key/order/placeholder parity against `en.js`, value-table completeness, fixture
  rendering in all nine languages and live rendering — 171 checks.
- Stable machine keys beside the localized labels: `uvLevel: { key, label }`,
  `usAqiCategory` / `europeanAqiCategory: { key, label }`, `windDirection: { compass, label }`.

### Fixed
- **Cross-script place lookup**: Open-Meteo's geocoder only finds names such as "上海" with a CJK language
  (and "서울" with Korean), so city lookups used to fail under a Latin output language. The lookup now falls
  back across scripts (requested → en → zh → ja → ko) instead of giving up.
- Localized summaries no longer leak English labels into daily/hourly rows.

### Changed
- The default summary language is now `en` (was `zh`); the shipped `cordis.patch.yml` still pins `zh`.
- Tool descriptions are English-first with Chinese keywords, for mixed-language agent pools.

## [0.3.0] - 2026-10-05

### Added
- **MCP server** (`bin/mcp-server.mjs`, command `dsh-weather-mcp`): dependency-free stdio JSON-RPC 2.0
  server exposing both tools to any MCP-capable agent — Claude Code, Codex CLI, Cursor, Windsurf,
  Gemini CLI, Cline, Zed, ChatGPT desktop. Accepts newline-delimited and `Content-Length` framing.
- **One-shot CLI** (`bin/cli.mjs`, command `dsh-weather`) for agents and scripts that only run commands:
  `dsh-weather 上海 --days 7`, `--date YYYY-MM-DD`, `--units imperial`, `--json`, `--lat/--lon`, `--help`.
- **Schema exporter** (`bin/schemas.mjs`, `tools/export-schemas.mjs`) plus checked-in
  `schema/openai-tools.json` and `schema/anthropic-tools.json`.
- `lib/harness.js`: load the tool definitions without DSH, so DSH, MCP, CLI and the schema files all read
  the *same* definitions — no drift between surfaces.
- Environment config for the non-DSH surfaces: `WEATHER_DEFAULT_LOCATION`, `WEATHER_LANG`, `WEATHER_UNITS`,
  `WEATHER_PROVIDER`, `WEATHER_TOOL_PREFIX`.
- Tests: `test/mcp-test.mjs` (real stdio MCP session: initialize → tools/list → tools/call, both framings,
  error paths) and `test/cli-test.mjs` (flags, exit codes, JSON output, live calls).
- README section *Use it with other agents* with copy-paste config for Claude Code, Codex, Cursor, Gemini CLI.

### Changed
- Package description/keywords now cover MCP and the other agents; `bin`, `schema` and extra exports added.
- `npm run test:all` runs the offline contract, MCP and CLI suites plus the DSH schema validator.

## [0.2.0] - 2026-10-05

### Added
- `get_weather` now returns a **3-day outlook by default** (today + next two days); pass `days: 0` for current conditions only.
- `get_weather_forecast` accepts `date: "YYYY-MM-DD"` and returns that day's 24 hourly rows.
- Forecast window auto-widens to 16 days when the requested `date` falls outside the default window.
- Summary gains a **trend line** for multi-day results: temperature range, wettest day, UV peak.

### Changed
- `days` default for `get_weather`: 1 → 3.
- Tool descriptions now mention the forecast defaults in both Chinese and English.

## [0.1.0] - 2026-10-04

### Added
- Initial release: `get_weather` (current conditions + air quality) and `get_weather_forecast` (1–16 day daily forecast, optional hourly).
- Temperature, feels-like, humidity, dew point, precipitation, cloud cover, pressure, UV index + level,
  16-point wind direction + speed + gusts, sunrise/sunset/daylight, PM2.5/PM10/O₃/NO₂/SO₂/CO, US AQI and European AQI.
- Location resolution: explicit coordinates → city name (Open-Meteo geocoding, Chinese supported) → configured
  default → public-IP fallback (ipwho.is → freeipapi.com → ip-api.com).
- Providers: Open-Meteo (primary), wttr.in (fallback for weather), Open-Meteo Air Quality (CAMS).
- Config via schemastery: `defaultLocation`, `language`, `units`, `includeAirQuality`, `cacheTtlSeconds`,
  `requestTimeoutMs`, `provider`.
- Tests: 187-check offline contract + live self-test, plus a schema-subset verifier that runs DSH's real validator.
