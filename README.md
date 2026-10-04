<div align="center">

# dsh-plugin-weather

**Global weather + air quality, callable at any time inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).**

[![CI](https://github.com/whaoran1018-cmd/dsh-plugin-weather/actions/workflows/ci.yml/badge.svg)](https://github.com/whaoran1018-cmd/dsh-plugin-weather/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Temperature · feels-like · humidity · UV index · sunrise/sunset · wind · PM2.5 / AQI — plus a 1–16 day forecast.
Powered by Open-Meteo. **No API key, no signup, no SDK.**

</div>

---

## What you get

Two agent-callable tools. Ask in natural language and the model picks the right one:

| Tool | What it returns |
| --- | --- |
| `get_weather` | Current conditions + air quality, **plus a 3-day outlook by default** (`days: 0` for current only) |
| `get_weather_forecast` | 1–16 day daily forecast; optional hourly rows (next 48 h, or exactly one chosen `date`) |

Every current-condition answer carries the full field set:

- **Temperature**, **apparent (feels-like) temperature**, humidity, dew point
- **UV index** with its level (Low / Moderate / High / Very high / Extreme)
- **Sunrise / sunset / daylight duration** in the location's own timezone
- **Wind**: 16-point compass name + degrees + speed + gusts
- Precipitation, rain/showers/snowfall, cloud cover, pressure, WMO weather description
- **Air quality**: PM2.5, PM10, O₃, NO₂, SO₂, CO, **US AQI** and **European AQI**, each with its category

Every daily row carries: date + weekday, weather, min/max temperature, min/max feels-like, precipitation
probability and amount, max UV + level, dominant wind, sunrise/sunset. Multi-day answers add a **trend line**
(temperature range, wettest day, UV peak).

## Install

### 1. Via the DSH plugin manager (recommended)

Once this repository is public, ask the agent (or use the Plugins page):

```
plugin_manager { "action": "install_bundle", "target": "github:whaoran1018-cmd/dsh-plugin-weather" }
```

The plugin manager installs the package, adds it to `dsh.profile.bundles`, and activates it.
Reload/restart DSH once if the tools do not appear immediately (see *Three DSH facts* below).

### 2. Into an existing profile by hand

```powershell
cd ~/.dsh/profiles/<profile>
pnpm add link:C:/path/to/dsh-plugin-weather      # or "file:", or a published version
```

Then add `"dsh-plugin-weather"` to `dsh.profile.bundles` in that profile's `package.json`.
The package ships its own `cordis.patch.yml`, so the Loader inserts the plugin row automatically.

### 3. Copy-in (no package manager)

Copy the folder to `~/.dsh/profiles/<profile>/plugins/dsh-plugin-weather` and append to the profile's
`cordis.patch.yml`:

```yaml
- insert:
    - id: weather
      name: 'dsh-plugin-weather'
```

Keep the folder out of dot-directories: DSH's watcher ignores `**/.*`.

## Usage

Just ask:

- "What's the weather in Shanghai?" / "上海现在天气怎么样"
- "Is it going to rain this week in New York?" / "上海未来 7 天"
- "Air quality in Jakarta" / "雅加达空气好不好"
- "What time is sunrise tomorrow?" / "明天几点日出"
- "Hourly forecast for Oct 7" (the model passes `date: "2026-10-07"`)
- "UV index at 31.23,121.47" (raw coordinates work too)

Each call returns two blocks: a **human-readable summary** (localised, with levels and emoji) and the
**complete JSON**, so the model can reason about exact numbers.

### Options

| Parameter | Applies to | Notes |
| --- | --- | --- |
| `location` | both | City name (Chinese or English) or `"lat,lon"`. Falls back to config `defaultLocation`, then public-IP location. |
| `latitude` / `longitude` | both | Explicit coordinates; take precedence over `location`. |
| `units` | both | `metric` (°C / km/h / mm) or `imperial` (°F / mph / inch). |
| `includeAirQuality` | both | Defaults to the plugin config (`true`). |
| `days` | both | `0–16`. `get_weather` defaults to 3, `get_weather_forecast` to 5. |
| `includeHourly` | forecast | Hourly rows from now, capped at 48. |
| `date` | forecast | `YYYY-MM-DD`. Returns that day's 24 hourly rows; auto-widens the window to 16 days when needed. |

### Plugin config

Set from the plugin settings UI, or in the profile's `cordis.patch.yml` under the row's `config`:

| Key | Default | Meaning |
| --- | --- | --- |
| `defaultLocation` | `""` | Used when no location is given. Empty = public-IP lookup. |
| `language` | `zh` | Summary language: `zh` or `en`. |
| `units` | `metric` | `metric` or `imperial`. |
| `includeAirQuality` | `true` | Attach the air-quality block. |
| `cacheTtlSeconds` | `300` | Local cache for identical requests; `0` disables. |
| `requestTimeoutMs` | `15000` | Per-request upstream timeout. |
| `provider` | `auto` | `auto` falls back to wttr.in if Open-Meteo fails; `open-meteo` never falls back. |

## How it resolves things

- **Location**: explicit coordinates → `location` (city via Open-Meteo geocoding; `"lat,lon"` parsed directly) →
  configured `defaultLocation` → public IP (`ipwho.is` → `freeipapi.com` → `ip-api.com`).
  When the result came from IP, the answer says so — IP geolocation is city-level and can be skewed by VPN/proxy.
- **Weather**: Open-Meteo forecast API, with wttr.in as a fallback source (fewer fields, no air quality).
- **Air quality**: Open-Meteo Air Quality (CAMS).
- All HTTP goes through Node's built-in `node:https` with a timeout, one retry and a small TTL cache — no
  runtime HTTP dependency is bundled.

## Development

```
dsh-plugin-weather/
├── lib/
│   ├── index.js      # plugin entry: name / inject / Config / apply
│   ├── tools.js      # the two ToolDefinitions (the schema subset matters!)
│   ├── service.js    # orchestration: resolve place → fetch → summarize
│   ├── geo.js        # coordinates, geocoding, IP fallback
│   ├── openmeteo.js  # forecast + air-quality providers, normalization
│   ├── wttr.js       # fallback provider
│   ├── format.js     # human-readable summary
│   ├── codes.js      # WMO weather codes, compass, UV/AQI categories
│   ├── http.js       # dependency-free JSON client (timeout/retry/cache)
│   └── config.js     # schemastery config schema
├── test/selftest.mjs # 199 checks: offline contract + live data
└── tools/
    ├── verify.ps1               # local install + verification helper
    └── verify-schema-subset.mjs # runs DSH's REAL schema validator on our tools
```

```powershell
npm install                 # only dependency: @deepseek-ai/schemastery
npm test                    # offline contract test (no network)
npm run test:live           # the same test plus live Open-Meteo calls
npm run test:schema         # validate tool schemas with DSH's real validator
```

### Three DSH facts worth knowing (learned the hard way)

1. **Tool schemas live in a narrow subset.** Only `type`, `oneOf`, `properties`, `required`,
   `additionalProperties`, `items`, `enum`, `const` plus the annotations `description`, `title`, `default`,
   `examples` are accepted, and `oneOf` needs ≥ 2 branches. `minimum` / `pattern` / `minLength` make the whole
   plugin row fail activation with `unsupported JSON schema: …`. `tools/verify-schema-subset.mjs` runs the real
   validator, so this cannot regress silently.
2. **Editing a host plugin's code does not hot-reload** in a running desktop profile (verified: a changed
   default stayed unchanged until the process reloaded, while pointing the patch at a new URL took effect
   immediately — module cache, not code). Reload/restart DSH after editing `lib/`.
3. **Do not declare `@deepseek-ai/dsh-*` peer dependencies** unless you pin them to the exact running version.
   DSH's compatibility gate compares those peers with the runtime version and will refuse to install the plugin
   otherwise. This package declares no DSH peers (only `@deepseek-ai/schemastery`, which the gate ignores) and
   relies on the injected `tools` service.

## License and data attribution

Code: [MIT](LICENSE).

Data sources — please keep the attribution when you publish or redistribute:

- Weather, forecast, geocoding: [Open-Meteo](https://open-meteo.com/) — free for non-commercial use, CC BY 4.0
- Air quality: [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api) (CAMS)
- Fallback weather: [wttr.in](https://wttr.in/)
- IP location: [ipwho.is](https://ipwho.is/), [freeipapi.com](https://freeipapi.com/), [ip-api.com](https://ip-api.com/)

Respect each provider's terms and rate limits; identical requests are cached for 5 minutes by default.

---

中文说明见 [README.zh-CN.md](README.zh-CN.md)。
