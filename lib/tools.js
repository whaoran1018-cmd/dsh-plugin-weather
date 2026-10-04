/** Tool definitions registered on the DSH tool registry. */
import { LANGUAGES, resolveLanguage, t } from './i18n.js'
import { describeQuery, runWeatherQuery } from './service.js'

const LOCATION_PARAMS = {
  location: {
    type: 'string',
    description:
      'Place: city name in any language (Shanghai / 上海 / Jakarta / New York), a region, or "lat,lon" (e.g. 31.23,121.47). Omitted → the plugin config defaultLocation, then the public-IP location. 地点：城市名（中/英文均可）或 "纬度,经度"。',
  },
  latitude: {
    type: 'number',
    description: 'Latitude -90…90, used together with longitude and taking precedence over location. 纬度。',
  },
  longitude: {
    type: 'number',
    description: 'Longitude -180…180, paired with latitude. 经度。',
  },
}

const COMMON_PARAMS = {
  ...LOCATION_PARAMS,
  units: {
    type: 'string',
    enum: ['metric', 'imperial'],
    description: 'metric = °C / km/h / mm (default), imperial = °F / mph / inch. 单位制。',
  },
  language: {
    type: 'string',
    enum: LANGUAGES,
    description: `Language of the summary text, one of ${LANGUAGES.join(', ')} (default: the plugin config). 摘要语言。`,
  },
  includeAirQuality: {
    type: 'boolean',
    description:
      'Include the air-quality block (PM2.5, PM10, O₃, NO₂, SO₂, CO, US AQI, European AQI). Defaults to the plugin config (true).',
  },
}

function outputFor(cfg) {
  return {
    schema: {
      type: 'object',
      additionalProperties: true,
    },
    render: (_args, value) => {
      const data = value && typeof value === 'object' ? value : { ok: false, message: String(value) }
      const language = resolveLanguage(data?.query?.language ?? cfg.language)
      const blocks = []
      if (typeof data.summary === 'string' && data.summary) {
        blocks.push({ type: 'text', text: data.summary })
      } else if (data.ok !== true) {
        blocks.push({
          type: 'text',
          text: t(language, 'summary.error', { message: data.message ?? t(language, 'summary.unknownError') }),
        })
      }
      const { summary, ...rest } = data
      blocks.push({ type: 'text', text: JSON.stringify(rest, null, 2) })
      return blocks
    },
  }
}

export function registerWeatherTools(ctx, cfg) {
  const tools = ctx.tools
  if (!tools || typeof tools.register !== 'function') {
    throw new Error('dsh-plugin-weather: the "tools" service is missing, cannot register tools.')
  }

  const presentCall = (args) => ({
    card: 'generic',
    title: `Weather · ${describeQuery(args, resolveLanguage(args?.language ?? cfg.language))}`,
    kind: 'fetch',
  })

  // 1) Current conditions + air quality (+ a 3-day outlook by default).
  tools.register({
    name: 'get_weather',
    description:
      'Current weather and environment for any place on earth, plus a 3-day daily outlook by default: temperature, ' +
      'apparent (feels-like) temperature, humidity, dew point, precipitation, cloud cover, pressure, UV index with its ' +
      'level, wind direction (16-point) + speed + gusts, sunrise/sunset, and air quality (PM2.5/PM10/O₃/NO₂/SO₂/CO, ' +
      'US AQI, European AQI). Data from Open-Meteo — free, no API key. Use it for «what is the weather / how hot does ' +
      'it feel / humidity / UV / sunrise / wind / air quality / the next few days»; pass days:0 for current conditions ' +
      'only, or use get_weather_forecast for longer ranges. ' +
      '当前天气与环境（默认附带未来 3 天逐日）：气温、体感、湿度、露点、降水、云量、气压、紫外线与等级、风向风速与阵风、日出日落、空气质量。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...COMMON_PARAMS,
        days: {
          type: 'integer',
          description:
            'Daily rows to include (0–16): date, weather, min/max temperature, feels-like range, precipitation probability and amount, max UV. Default 3 (today + 2 days); 0 = current conditions only. 逐日天数。',
        },
      },
    },
    output: outputFor(cfg),
    timeoutMs: 30000,
    isConcurrencySafe: () => true,
    presentCall,
    execute: (args, exec) => runWeatherQuery(args, cfg, exec, { defaultDays: 3, minDays: 0 }),
  })

  // 2) Multi-day forecast (+ optional hourly, optionally for one chosen day).
  tools.register({
    name: 'get_weather_forecast',
    description:
      'Daily forecast for any place on earth, 1–16 days: min/max temperature, feels-like temperature, weather, ' +
      'precipitation probability and amount, max UV with its level, wind, sunrise/sunset per day. Optional hourly rows ' +
      '(next 48 h) or exactly one chosen day via date="YYYY-MM-DD". Use it for «will it rain this week / which day is ' +
      'best outdoors / weather at my destination». ' +
      '全球 1–16 天逐日预报，可选逐时或只看某一天；用于「这周会不会下雨 / 哪天适合户外 / 出差地天气」。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...COMMON_PARAMS,
        days: {
          type: 'integer',
          description: 'Forecast days, 1–16 (default 5). 预报天数。',
        },
        includeHourly: {
          type: 'boolean',
          description: 'Also return hourly rows from now, capped at 48 (default false). 附带逐时。',
        },
        date: {
          type: 'string',
          description:
            'Only that local day (YYYY-MM-DD, inside the forecast range): returns its 24 hourly rows and widens the window to 16 days when needed. 只看某一天的逐时。',
        },
      },
    },
    output: outputFor(cfg),
    timeoutMs: 30000,
    isConcurrencySafe: () => true,
    presentCall,
    execute: (args, exec) => runWeatherQuery(args, cfg, exec, { defaultDays: 5, minDays: 1, hourlyLimit: 48 }),
  })
}
