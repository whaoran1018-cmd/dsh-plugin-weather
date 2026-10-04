/**
 * Turn a user-supplied place into coordinates: explicit lat/lon, "lat,lon"
 * text, city name via Open-Meteo Geocoding, configured default, or the public
 * IP location as the last resort.
 */
import { getJson } from './http.js'

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

export async function geocode(query, cfg) {
  const text = String(query ?? '').trim()
  if (text.length < 2) {
    throw new Error('地点名太短：请给至少 2 个字符的城市名，或直接给 "纬度,经度"。')
  }
  const url =
    'https://geocoding-api.open-meteo.com/v1/search' +
    `?name=${encodeURIComponent(text)}&count=8&format=json` +
    `&language=${cfg.language === 'en' ? 'en' : 'zh'}`
  const json = await getJson(url, {
    timeoutMs: cfg.requestTimeoutMs,
    cacheTtlMs: Math.max(cfg.cacheTtlSeconds, 600) * 1000,
    signal: cfg.signal,
  })
  const results = Array.isArray(json?.results) ? json.results : []
  if (!results.length) {
    throw new Error(
      `找不到地点「${text}」。可以换成更完整的名字（如「上海,中国」「Springfield, IL, USA」），或直接给 "纬度,经度"。`,
    )
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
  const failures = []

  // 1) ipwho.is — https, no key.
  try {
    const json = await getJson('https://ipwho.is/', {
      timeoutMs: cfg.requestTimeoutMs,
      cacheTtlMs: 600000,
      signal: cfg.signal,
    })
    if (json && json.success !== false && Number.isFinite(Number(json.latitude))) {
      return {
        name: json.city || json.region || json.country || '当前网络位置',
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
    failures.push('ipwho.is 返回异常')
  } catch (error) {
    failures.push(`ipwho.is：${error instanceof Error ? error.message : String(error)}`)
  }

  // 2) freeipapi.com — https, no key.
  try {
    const json = await getJson('https://freeipapi.com/api/json', {
      timeoutMs: cfg.requestTimeoutMs,
      cacheTtlMs: 600000,
      signal: cfg.signal,
    })
    const latitude = positiveNumber(json?.latitude)
    const longitude = positiveNumber(json?.longitude)
    if (latitude !== null && longitude !== null) {
      const zones = Array.isArray(json?.timeZones) ? json.timeZones : []
      return {
        name: json.cityName || json.regionName || json.countryName || '当前网络位置',
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
    failures.push('freeipapi.com 返回异常')
  } catch (error) {
    failures.push(`freeipapi.com：${error instanceof Error ? error.message : String(error)}`)
  }

  // 3) ip-api.com — plain HTTP free tier, last resort.
  try {
    const json = await getJson('http://ip-api.com/json/?fields=status,message,country,regionName,city,lat,lon,timezone', {
      timeoutMs: cfg.requestTimeoutMs,
      cacheTtlMs: 600000,
      signal: cfg.signal,
    })
    const latitude = positiveNumber(json?.lat)
    const longitude = positiveNumber(json?.lon)
    if (json?.status === 'success' && latitude !== null && longitude !== null) {
      return {
        name: json.city || json.regionName || json.country || '当前网络位置',
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
    failures.push(`ip-api.com 返回异常${json?.message ? `：${json.message}` : ''}`)
  } catch (error) {
    failures.push(`ip-api.com：${error instanceof Error ? error.message : String(error)}`)
  }

  throw new Error(
    `IP 定位失败（${failures.join('；')}）。请直接指定地点，例如 location:"上海" 或 latitude/longitude，` +
      '也可以在插件配置里设置 defaultLocation。',
  )
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
