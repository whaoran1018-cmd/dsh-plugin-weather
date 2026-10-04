/**
 * Semantic layer: weather-code → emoji, compass indexing, UV/AQI level lookup.
 * All human-readable text comes from lib/i18n.js, so this file stays language-neutral.
 */
import { aqiName, compassName, uvName, windPhrase, wmoText, weekdayName as localeWeekday } from './i18n.js'

/** Stable machine keys keep the JSON parseable regardless of `language`. */
const UV_KEYS = ['low', 'moderate', 'high', 'very_high', 'extreme']
const UV_MAX = [2, 5, 7, 10, Infinity]
const US_AQI_MAX = [50, 100, 150, 200, 300, Infinity]
const US_AQI_KEYS = ['good', 'moderate', 'usg', 'unhealthy', 'very_unhealthy', 'hazardous']
const EU_AQI_MAX = [20, 40, 60, 80, 100, Infinity]
const EU_AQI_KEYS = ['good', 'fair', 'moderate', 'poor', 'very_poor', 'extremely_poor']

/** 16-point abbreviations — the language-independent compass value. */
export const COMPASS_ABBR = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
]

/** Localized WMO weather text, e.g. "Light drizzle" / "小毛毛雨" / "Llovizna débil". */
export function weatherText(code, language = 'en') {
  return wmoText(code, language)
}

/** Compass index 0-15 for a bearing in degrees. */
export function compassIndex(degrees) {
  const value = Number(degrees)
  if (!Number.isFinite(value)) return null
  return Math.round((((value % 360) + 360) % 360) / 22.5) % 16
}

/** Localized compass name plus its stable abbreviation. */
export function windCompass(degrees, language = 'en') {
  const index = compassIndex(degrees)
  if (index === null) return null
  return { index, compass: COMPASS_ABBR[index], label: compassName(index, language) }
}

/** Localized wind phrase, e.g. "North-northeast" or "东北偏北风". */
export function windDirectionLabel(degrees, language = 'en') {
  const index = compassIndex(degrees)
  return index === null ? null : windPhrase(index, language)
}

export function weatherEmoji(code) {
  const c = Number(code)
  if (c === 0) return '☀️'
  if (c === 1) return '🌤️'
  if (c === 2) return '⛅'
  if (c === 3) return '☁️'
  if (c === 45 || c === 48) return '🌫️'
  if (c >= 51 && c <= 57) return '🌦️'
  if (c >= 61 && c <= 67) return '🌧️'
  if (c >= 71 && c <= 77) return '❄️'
  if (c >= 80 && c <= 82) return '🌧️'
  if (c === 85 || c === 86) return '🌨️'
  if (c >= 95) return '⛈️'
  return '🌡️'
}

/**
 * UV index → { key, label }: stable key for machines, localized label for humans.
 * @returns {{key: string, label: string}|null}
 */
export function uvLevel(value, language = 'en') {
  const v = Number(value)
  if (!Number.isFinite(v)) return null
  const index = UV_MAX.findIndex((max) => v <= max)
  return { key: UV_KEYS[index], label: uvName(index, language) }
}

/**
 * AQI → { key, label }. `scale` is 'us' (default) or 'eu'.
 * @returns {{key: string, label: string}|null}
 */
export function aqiCategory(value, scale = 'us', language = 'en') {
  const v = Number(value)
  if (!Number.isFinite(v)) return null
  const isEu = scale === 'eu'
  const index = (isEu ? EU_AQI_MAX : US_AQI_MAX).findIndex((max) => v <= max)
  return { key: (isEu ? EU_AQI_KEYS : US_AQI_KEYS)[index], label: aqiName(isEu ? 'eu' : 'us', index, language) }
}

/** Localized weekday label for a YYYY-MM-DD date. */
export function weekdayName(dateString, language = 'en') {
  const date = new Date(`${dateString}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return ''
  return localeWeekday(date.getUTCDay(), language)
}
