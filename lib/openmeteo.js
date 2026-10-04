/** Open-Meteo providers (forecast + air quality) and their normalization. */
import { getJson } from './http.js'
import { aqiCategory, uvLevel, weatherText, windCompass, windDirectionLabel } from './codes.js'

const UNIT_SETS = {
  metric: {
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
    labels: { temperature: '°C', windSpeed: 'km/h', precipitation: 'mm', pressure: 'hPa', humidity: '%' },
  },
  imperial: {
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    labels: { temperature: '°F', windSpeed: 'mph', precipitation: 'inch', pressure: 'hPa', humidity: '%' },
  },
}

const CURRENT_VARS = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'is_day',
  'precipitation',
  'rain',
  'showers',
  'snowfall',
  'weather_code',
  'cloud_cover',
  'pressure_msl',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'uv_index',
  'dew_point_2m',
]

const DAILY_VARS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'apparent_temperature_max',
  'apparent_temperature_min',
  'sunrise',
  'sunset',
  'daylight_duration',
  'uv_index_max',
  'precipitation_sum',
  'precipitation_probability_max',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'wind_direction_10m_dominant',
]

const HOURLY_VARS = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'precipitation_probability',
  'uv_index',
  'wind_speed_10m',
  'wind_direction_10m',
]

const AIR_VARS = [
  'pm10',
  'pm2_5',
  'carbon_monoxide',
  'nitrogen_dioxide',
  'sulphur_dioxide',
  'ozone',
  'us_aqi',
  'european_aqi',
  'uv_index',
]

export function unitSet(units) {
  return UNIT_SETS[units] ?? UNIT_SETS.metric
}

function num(value, digits = 1) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  const factor = 10 ** digits
  return Math.round(parsed * factor) / factor
}

function clock(isoString) {
  if (typeof isoString !== 'string') return null
  const match = /T(\d{2}:\d{2})/.exec(isoString)
  return match ? match[1] : null
}

function duration(seconds) {
  const total = Number(seconds)
  if (!Number.isFinite(total)) return null
  const hours = Math.floor(total / 3600)
  const minutes = Math.round((total % 3600) / 60)
  return `${hours}h${String(minutes).padStart(2, '0')}m`
}

export function windInfo(degrees, language = 'en') {
  const compass = windCompass(degrees, language)
  const direction = compass
    ? { degrees: num(degrees, 0), compass: compass.compass, label: compass.label }
    : { degrees: null, compass: null, label: null }
  return { direction, label: windDirectionLabel(degrees, language) }
}

function normalizeWeather(json, { language, units, includeHourly }) {
  const current = json?.current ?? {}
  const daily = json?.daily ?? {}
  const { direction, label } = windInfo(current.wind_direction_10m, language)
  const uv = uvLevel(current.uv_index, language)

  const today = {
    sunrise: clock(daily.sunrise?.[0]),
    sunset: clock(daily.sunset?.[0]),
    daylightDuration: duration(daily.daylight_duration?.[0]),
  }

  const currentBlock = {
    time: current.time ?? null,
    temperature: num(current.temperature_2m),
    apparentTemperature: num(current.apparent_temperature),
    humidity: num(current.relative_humidity_2m, 0),
    dewPoint: num(current.dew_point_2m),
    precipitation: num(current.precipitation),
    rain: num(current.rain),
    showers: num(current.showers),
    snowfall: num(current.snowfall),
    cloudCover: num(current.cloud_cover, 0),
    pressure: num(current.pressure_msl),
    weatherCode: Number.isFinite(Number(current.weather_code)) ? Number(current.weather_code) : null,
    weather: weatherText(current.weather_code, language),
    isDay: current.is_day === 1 || current.is_day === true,
    uvIndex: num(current.uv_index),
    uvLevel: uv,
    windSpeed: num(current.wind_speed_10m),
    windGusts: num(current.wind_gusts_10m),
    windDirectionDegrees: direction.degrees,
    windDirection: { compass: direction.compass, label: direction.label },
    windDirectionLabel: label,
    sunrise: today.sunrise,
    sunset: today.sunset,
    daylightDuration: today.daylightDuration,
  }

  const dates = Array.isArray(daily.time) ? daily.time : []
  const dailyRows = dates.map((date, index) => {
    const max = daily.temperature_2m_max?.[index]
    const min = daily.temperature_2m_min?.[index]
    const uvMax = daily.uv_index_max?.[index]
    const dailyWind = windInfo(daily.wind_direction_10m_dominant?.[index], language)
    return {
      date,
      weatherCode: Number.isFinite(Number(daily.weather_code?.[index])) ? Number(daily.weather_code[index]) : null,
      weather: weatherText(daily.weather_code?.[index], language),
      temperatureMax: num(max),
      temperatureMin: num(min),
      apparentTemperatureMax: num(daily.apparent_temperature_max?.[index]),
      apparentTemperatureMin: num(daily.apparent_temperature_min?.[index]),
      precipitationSum: num(daily.precipitation_sum?.[index]),
      precipitationProbabilityMax: num(daily.precipitation_probability_max?.[index], 0),
      uvIndexMax: num(uvMax),
      uvLevel: uvLevel(uvMax),
      windSpeedMax: num(daily.wind_speed_10m_max?.[index]),
      windGustsMax: num(daily.wind_gusts_10m_max?.[index]),
      windDirectionDominant: dailyWind.direction,
      windDirectionLabel: dailyWind.label,
      sunrise: daily.sunrise?.[index] ? clock(daily.sunrise[index]) : null,
      sunset: daily.sunset?.[index] ? clock(daily.sunset[index]) : null,
      daylightDuration: duration(daily.daylight_duration?.[index]),
    }
  })

  let hourlyRows = []
  if (includeHourly && Array.isArray(json?.hourly?.time)) {
    hourlyRows = json.hourly.time.map((time, index) => ({
      time,
      temperature: num(json.hourly.temperature_2m?.[index]),
      apparentTemperature: num(json.hourly.apparent_temperature?.[index]),
      humidity: num(json.hourly.relative_humidity_2m?.[index], 0),
      precipitationProbability: num(json.hourly.precipitation_probability?.[index], 0),
      uvIndex: num(json.hourly.uv_index?.[index]),
      windSpeed: num(json.hourly.wind_speed_10m?.[index]),
      windDirectionDegrees: num(json.hourly.wind_direction_10m?.[index], 0),
    }))
  }

  return {
    source: 'open-meteo',
    timezone: json?.timezone ?? null,
    timezoneAbbreviation: json?.timezone_abbreviation ?? null,
    utcOffsetSeconds: json?.utc_offset_seconds ?? null,
    elevation: num(json?.elevation, 0),
    observedAt: current.time ?? null,
    current: currentBlock,
    daily: dailyRows,
    hourly: hourlyRows,
  }
}

export async function fetchForecast(location, options) {
  const { language, units, days, includeHourly, timeoutMs, cacheTtlMs, signal } = options
  const set = unitSet(units)
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: CURRENT_VARS.join(','),
    daily: DAILY_VARS.join(','),
    timezone: 'auto',
    forecast_days: String(Math.min(16, Math.max(1, days))),
    temperature_unit: set.temperature_unit,
    wind_speed_unit: set.wind_speed_unit,
    precipitation_unit: set.precipitation_unit,
  })
  if (includeHourly) params.set('hourly', HOURLY_VARS.join(','))
  const json = await getJson(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
    timeoutMs,
    cacheTtlMs,
    signal,
    language,
  })
  return normalizeWeather(json, { language, units, includeHourly })
}

export function normalizeAirQuality(json, language = 'en') {
  const current = json?.current ?? {}
  return {
    observedAt: current.time ?? null,
    usAqi: num(current.us_aqi, 0),
    usAqiCategory: aqiCategory(current.us_aqi, 'us', language),
    europeanAqi: num(current.european_aqi, 0),
    europeanAqiCategory: aqiCategory(current.european_aqi, 'eu', language),
    pm25: num(current.pm2_5),
    pm10: num(current.pm10),
    ozone: num(current.ozone),
    nitrogenDioxide: num(current.nitrogen_dioxide),
    sulphurDioxide: num(current.sulphur_dioxide),
    carbonMonoxide: num(current.carbon_monoxide),
    uvIndex: num(current.uv_index),
    units: {
      particulate: 'µg/m³',
      ozone: 'µg/m³',
      nitrogenDioxide: 'µg/m³',
      sulphurDioxide: 'µg/m³',
      carbonMonoxide: 'µg/m³',
    },
    source: 'Open-Meteo Air Quality (CAMS)',
  }
}

export async function fetchAirQuality(location, options) {
  const { timeoutMs, cacheTtlMs, signal, language = 'en' } = options
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: AIR_VARS.join(','),
    timezone: 'auto',
  })
  const json = await getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?${params.toString()}`, {
    timeoutMs,
    cacheTtlMs,
    signal,
    language,
  })
  return normalizeAirQuality(json, language)
}
