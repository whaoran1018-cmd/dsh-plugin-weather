/**
 * Locale registry and the tiny translation helper used by every surface
 * (DSH tools, MCP server, CLI).
 *
 * Contract for lib/locales/<code>.js — every catalog MUST have exactly the same
 * keys as lib/locales/en.js, in the same order, with only the values translated:
 *
 *   code / name                     identifier + the language's own name
 *   summary.*, label.*, short.*     summary text (placeholders like {message})
 *   row.*                           full-line templates where punctuation differs
 *   wind.label                      how a compass point is phrased ("{dir}风")
 *   value.*                         generic fallbacks
 *   weekday.0..6                    Sunday = 0
 *   wmo.0 .. wmo.99                 WMO weather codes (31 entries)
 *   compass.0..15                   N, NNE, NE, … in 22.5° steps
 *   uv.0..4                         low → extreme
 *   aqi.us.0..5, aqi.eu.0..5        AQI category names
 *
 * test/i18n-test.mjs fails the build when a catalog drifts from en.js.
 */
import zh from './locales/zh.js'
import en from './locales/en.js'
import es from './locales/es.js'
import ja from './locales/ja.js'
import ko from './locales/ko.js'
import pt from './locales/pt.js'
import it from './locales/it.js'
import fr from './locales/fr.js'
import de from './locales/de.js'

/** Order used in docs, the CLI `--lang` help and the DSH config enum. */
export const LANGUAGES = ['zh', 'en', 'es', 'ja', 'ko', 'pt', 'it', 'fr', 'de']
export const DEFAULT_LANGUAGE = 'en'

const CATALOGS = { zh, en, es, ja, ko, pt, it, fr, de }

/** Accepts "zh", "zh-CN", "pt_BR", "EN" … and falls back to English. */
export function resolveLanguage(input) {
  if (typeof input !== 'string') return DEFAULT_LANGUAGE
  const base = input.trim().toLowerCase().replace(/_/g, '-').split('-')[0]
  return LANGUAGES.includes(base) ? base : DEFAULT_LANGUAGE
}

export function catalog(language) {
  return CATALOGS[resolveLanguage(language)] ?? CATALOGS[DEFAULT_LANGUAGE]
}

/** Localized language names, e.g. [{ code:'ja', name:'日本語' }, …]. */
export function supportedLanguages() {
  return LANGUAGES.map((code) => ({ code, name: CATALOGS[code]?.name ?? code }))
}

/**
 * Translate one key. Missing keys fall back to English, and a key missing
 * everywhere returns itself so the i18n test can catch it.
 */
export function t(language, key, params) {
  const primary = CATALOGS[resolveLanguage(language)]
  const raw = primary?.[key] ?? CATALOGS[DEFAULT_LANGUAGE][key]
  if (typeof raw !== 'string') return key
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (_, name) => (params[name] === undefined ? '' : String(params[name])))
}

// --- value tables -----------------------------------------------------------

/** WMO weather code → localized text. */
export function wmoText(code, language) {
  if (code === null || code === undefined) return t(language, 'value.unknown')
  const key = `wmo.${Number(code)}`
  const text = t(language, key)
  return text === key ? t(language, 'row.weatherCode', { code }) : text
}

/** 16-point compass: index 0 = N … 15 = NNW. */
export function compassName(index, language) {
  const key = `compass.${((index % 16) + 16) % 16}`
  return t(language, key)
}

/** Localized wind phrase, e.g. "NNE" (en) or "东北偏北风" (zh). */
export function windPhrase(index, language) {
  return t(language, 'wind.label', { dir: compassName(index, language) })
}

/** UV index → localized level name (index 0=low … 4=extreme). */
export function uvName(index, language) {
  return t(language, `uv.${Math.min(4, Math.max(0, index))}`)
}

/** AQI category name; scale is 'us' or 'eu'. */
export function aqiName(scale, index, language) {
  const suffix = scale === 'eu' ? 'eu' : 'us'
  return t(language, `aqi.${suffix}.${Math.min(5, Math.max(0, index))}`)
}

/** Weekday label, 0 = Sunday. */
export function weekdayName(index, language) {
  return t(language, `weekday.${((index % 7) + 7) % 7}`)
}

export function languageName(language) {
  return catalog(language).name ?? resolveLanguage(language)
}
