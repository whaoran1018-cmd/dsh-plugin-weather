/**
 * Turn a user-supplied place into coordinates: explicit lat/lon, "lat,lon"
 * text, city name via Open-Meteo Geocoding, configured default, or the public
 * IP location as the last resort.
 */
import { getJson } from './http.js'
import { resolveLanguage, t } from './i18n.js'

const COORDINATE_RE = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,，]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/
const FEATURE_RANK = { PPLC: 6, PPLA: 5, PPLA2: 4, PPLA3: 3, PPLA4: 2, PPL: 1 }

export function parseCoordinateText(text) {
  if (typeof text !== 'string') return null
  const match = COORDINATE_RE.exec(text)
  if (!match) return null
  const latitude = Number(match[1])
  const longitude = Number(match[2])
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) return null
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) return null
  return { latitude, longitude }
}

function normalizeName(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '')
}

function rankCandidates(results, query) {
  const wanted = normalizeName(query)
  return [...results]
    .map((item) => ({
      ...item,
      score:
        (normalizeName(item.name) === wanted ? 1000 : 0) +
        (FEATURE_RANK[item.feature_code] ?? 0) * 10 +
        Math.min(9, Math.log10(Math.max(1, Number(item.population) || 1))),
    }))
    .sort((a, b) => b.score - a.score)
}

/**
 * One Open-Meteo geocoding lookup. `language` only localizes the returned
 * names; passing null asks for the API default.
 */
async function searchPlaces(text, language, cfg) {
  const url =
    'https://geocoding-api.open-meteo.com/v1/search' +
    `?name=${encodeURIComponent(text)}&count=8&format=json` +
    (language ? `&language=${language}` : '')
  const json = await getJson(url, {
    timeoutMs: cfg.requestTimeoutMs,
    cacheTtlMs: Math.max(cfg.cacheTtlSeconds, 600) * 1000,
    signal: cfg.signal,
    language: language ?? 'en',
  })
  return Array.isArray(json?.results) ? json.results : []
}

export async function geocode(query, cfg) {
  const language = resolveLanguage(cfg.language)
  const tr = (key, params) => t(language, key, params)
  const text = String(query ?? '').trim()
  if (text.length < 2) {
    throw new Error(tr('geo.tooShort'))
  }

  // Prefer names in the requested language, then fall back across scripts:
  // Open-Meteo's geocoder only finds "上海" with a CJK language (zh/ja), and
  // only finds e.g. "서울" with ko — while Latin names resolve with any of them.
  // Extra lookups only happen when the previous one returned nothing.
  const attempts = [...new Set([language, 'en', 'zh', 'ja', 'ko'])]
  let results = []
  for (const attempt of attempts) {
    results = await searchPlaces(text, attempt, cfg)
    if (results.length) break
  }
  if (!results.length) {
    throw new Error(tr('geo.notFound', { query: text }))
  }
  return rankCandidates(results, text).map((item) => ({
    name: item.name,
    admin1: item.admin1 ?? null,
    country: item.country ?? null,
    countryCode: item.country_code ?? null,
    timezone: item.timezone ?? null,
    latitude: item.latitude,
    longitude: item.longitude,
    elevation: item.elevation ?? null,
    population: item.population ?? null,
    featureCode: item.feature_code ?? null,
  }))
}

function positiveNumber(...values) {
  for (const value of values) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/**
 * Coarse fallback when no location was given: the public IP location.
 * Three independent providers, tried in order, because each one is flaky.
 */
async function ipLocate(cfg) {
  const language = resolveLanguage(cfg.language)
  const tr = (key, params) => t(language, key, params)
  const failures = []

  // 1) ipwho.is — https, no key.
  try {
    const json = await getJson('https://ipwho.is/', {
      timeoutMs: cfg.requestTimeoutMs,
      cacheTtlMs: 600000,
      signal: cfg.signal,
      language,
    })
    if (json && json.success !== false && Number.isFinite(Number(json.latitude))) {
      return {
        name: json.city || json.region || json.country || tr('geo.networkLocation'),
        admin1: json.region ?? null,
        country: json.country ?? null,
        countryCode: json.country_code ?? null,
        timezone: json.timezone?.id ?? (typeof json.timezone === 'string' ? json.timezone : null),
        latitude: Number(json.latitude),
        longitude: Number(json.longitude),
        elevation: null,
        source: 'ip',
        provider: 'ipwho.is',
      }
    }
    failures.push(tr('geo.providerBadResponse', { provider: 'ipwho.is' }))
  } catch (error) {
    failures.push(
      tr('geo.providerFailed', {
        provider: 'ipwho.is',
        message: error instanceof Error ? error.message : String(error),
      }),
    )
  }

  // 2) freeipapi.com — https, no key.
  try {
    const json = await getJson('https://freeipapi.com/api/json', {
      timeoutMs: cfg.requestTimeoutMs,
      cacheTtlMs: 600000,
      signal: cfg.signal,
      language,
    })
    const latitude = positiveNumber(json?.latitude)
    const longitude = positiveNumber(json?.longitude)
    if (latitude !== null && longitude !== null) {
      const zones = Array.isArray(json?.timeZones) ? json.timeZones : []
      return {
        name: json.cityName || json.regionName || json.countryName || tr('geo.networkLocation'),
        admin1: json.regionName ?? null,
        country: json.countryName ?? null,
        countryCode: json.countryCode ?? null,
        timezone: zones[0] ?? null,
        latitude,
        longitude,
        elevation: null,
        source: 'ip',
        provider: 'freeipapi.com',
      }
    }
    failures.push(tr('geo.providerBadResponse', { provider: 'freeipapi.com' }))
  } catch (error) {
    failures.push(
      tr('geo.providerFailed', {
        provider: 'freeipapi.com',
        message: error instanceof Error ? error.message : String(error),
      }),
    )
  }

  // 3) ip-api.com — plain HTTP free tier, last resort.
  try {
    const json = await getJson('http://ip-api.com/json/?fields=status,message,country,regionName,city,lat,lon,timezone', {
      timeoutMs: cfg.requestTimeoutMs,
      cacheTtlMs: 600000,
      signal: cfg.signal,
      language,
    })
    const latitude = positiveNumber(json?.lat)
    const longitude = positiveNumber(json?.lon)
    if (json?.status === 'success' && latitude !== null && longitude !== null) {
      return {
        name: json.city || json.regionName || json.country || tr('geo.networkLocation'),
        admin1: json.regionName ?? null,
        country: json.country ?? null,
        countryCode: null,
        timezone: json.timezone ?? null,
        latitude,
        longitude,
        elevation: null,
        source: 'ip',
        provider: 'ip-api.com',
      }
    }
    failures.push(
      json?.message
        ? `${tr('geo.providerBadResponse', { provider: 'ip-api.com' })}: ${json.message}`
        : tr('geo.providerBadResponse', { provider: 'ip-api.com' }),
    )
  } catch (error) {
    failures.push(
      tr('geo.providerFailed', {
        provider: 'ip-api.com',
        message: error instanceof Error ? error.message : String(error),
      }),
    )
  }

  throw new Error(tr('geo.ipFailed', { details: failures.join('; ') }))
}

function fromCoordinates(latitude, longitude) {
  return {
    name: `${Number(latitude).toFixed(3)},${Number(longitude).toFixed(3)}`,
    admin1: null,
    country: null,
    countryCode: null,
    timezone: null,
    latitude: Number(latitude),
    longitude: Number(longitude),
    elevation: null,
    source: 'coordinates',
  }
}

/**
 * @returns {Promise<{name:string, latitude:number, longitude:number, source:string,
 *   admin1?:string|null, country?:string|null, timezone?:string|null, alternatives?:unknown[]}>}
 */
export async function resolveLocation(args, cfg) {
  const latitude = Number(args?.latitude)
  const longitude = Number(args?.longitude)
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return fromCoordinates(latitude, longitude)
  }

  const raw = typeof args?.location === 'string' ? args.location.trim() : ''
  if (raw) {
    const coords = parseCoordinateText(raw)
    if (coords) return fromCoordinates(coords.latitude, coords.longitude)
    const ranked = await geocode(raw, cfg)
    const [best, ...rest] = ranked
    return { ...best, source: 'geocoding', alternatives: rest.slice(0, 4) }
  }

  if (cfg.defaultLocation) {
    const coords = parseCoordinateText(cfg.defaultLocation)
    if (coords) return { ...fromCoordinates(coords.latitude, coords.longitude), source: 'config-default' }
    const ranked = await geocode(cfg.defaultLocation, cfg)
    const [best, ...rest] = ranked
    return { ...best, source: 'config-default', alternatives: rest.slice(0, 4) }
  }

  return ipLocate(cfg)
}
