/** Orchestration: resolve the place, fetch weather (+ air quality), summarize. */
import { resolveLocation } from './geo.js'
import { fetchAirQuality, fetchForecast, unitSet } from './openmeteo.js'
import { fetchWttr } from './wttr.js'
import { renderWeatherText } from './format.js'
import { resolveLanguage, t } from './i18n.js'

export function errorMessage(error) {
  if (error instanceof Error) return error.message
  return String(error ?? 'unknown error')
}

export function clampInt(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

export function describeQuery(args, language = 'en') {
  const input = args && typeof args === 'object' ? args : {}
  const latitude = Number(input.latitude)
  const longitude = Number(input.longitude)
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) return `${latitude},${longitude}`
  if (typeof input.location === 'string' && input.location.trim()) return input.location.trim()
  return t(language, 'service.autoLocation')
}

export function failure(message, extra = {}) {
  return { ok: false, error: true, message, ...extra }
}

/**
 * @param {Record<string, unknown>} args
 * @param {ReturnType<import('./config.js').resolveConfig>} cfg
 * @param {{signal?: AbortSignal}|undefined} exec
 * @param {{defaultDays?: number, minDays?: number, forceHourly?: boolean, hourlyLimit?: number}} options
 */
export async function runWeatherQuery(args, cfg, exec, options = {}) {
  const input = args && typeof args === 'object' ? args : {}
  const language = resolveLanguage(input.language ?? cfg.language)
  const tr = (key, params) => t(language, key, params)
  const queryText = describeQuery(input, language)

  const units = input.units === 'imperial' ? 'imperial' : input.units === 'metric' ? 'metric' : cfg.units
  const set = unitSet(units)
  const days = clampInt(input.days, options.minDays ?? 1, 16, options.defaultDays ?? 1)
  const requestedDate = typeof input.date === 'string' ? input.date.trim() : ''
  const wantedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : null
  const includeHourly = input.includeHourly === true || options.forceHourly === true || wantedDate !== null
  const includeAirQuality = input.includeAirQuality === false ? false : cfg.includeAirQuality
  const callOptions = {
    language,
    units,
    timeoutMs: cfg.requestTimeoutMs,
    cacheTtlMs: Math.round(cfg.cacheTtlSeconds * 1000),
    signal: exec?.signal,
  }

  let location
  try {
    location = await resolveLocation(input, { ...cfg, language, signal: exec?.signal })
  } catch (error) {
    return failure(tr('error.locationFailed', { message: errorMessage(error) }), {
      query: { input: queryText, language, units },
      hints: [tr('hint.coordinates'), tr('hint.defaultLocation')],
    })
  }

  const notes = []
  let weather = null
  try {
    weather = await fetchForecast(location, { ...callOptions, days, includeHourly })
  } catch (error) {
    notes.push(tr('note.forecastFailed', { message: errorMessage(error) }))
    if (cfg.provider === 'auto') {
      try {
        weather = await fetchWttr(location, callOptions)
        notes.push(tr('note.fallbackUsed'))
      } catch (fallbackError) {
        notes.push(tr('note.fallbackFailed', { message: errorMessage(fallbackError) }))
      }
    }
  }

  if (!weather) {
    return failure(tr('error.noWeather', { message: notes.join('; ') }), {
      query: { input: queryText, language, units },
      location: { name: location.name, latitude: location.latitude, longitude: location.longitude },
      notes,
      hints: [tr('hint.network')],
    })
  }

  // A chosen date beyond the current window: widen once to the 16-day maximum.
  const lastForecastDate = weather.daily?.at(-1)?.date ?? null
  if (wantedDate && lastForecastDate && wantedDate > lastForecastDate && days < 16) {
    try {
      weather = await fetchForecast(location, { ...callOptions, days: 16, includeHourly: true })
      notes.push(tr('note.windowWidened', { date: wantedDate }))
    } catch (error) {
      notes.push(tr('note.widenFailed', { message: errorMessage(error) }))
    }
  }

  let airQuality = null
  if (includeAirQuality) {
    try {
      airQuality = await fetchAirQuality(location, callOptions)
    } catch (error) {
      notes.push(tr('note.airQualityFailed', { message: errorMessage(error) }))
    }
  }

  let hourly = Array.isArray(weather.hourly) ? weather.hourly : []
  const hourlyLimit = options.hourlyLimit ?? 48
  let hourlyDate = null
  const firstDate = weather.daily?.[0]?.date ?? null
  const lastDate = weather.daily?.at(-1)?.date ?? null
  if (wantedDate) {
    const dayRows = hourly.filter((row) => String(row.time ?? '').startsWith(wantedDate))
    if (dayRows.length) {
      hourly = dayRows
      hourlyDate = wantedDate
      if (!firstDate || wantedDate < firstDate) {
        notes.push(
          tr('note.dateBeforeWindow', {
            date: wantedDate,
            range: firstDate ? ` (${firstDate} ~ ${lastDate})` : '',
          }),
        )
      }
    } else {
      notes.push(
        tr('note.dateOutOfWindow', {
          date: wantedDate,
          first: firstDate ?? '?',
          last: lastDate ?? '?',
        }),
      )
      hourly = hourly.slice(0, hourlyLimit)
    }
  } else if (hourly.length > hourlyLimit) {
    hourly = hourly.slice(0, hourlyLimit)
    notes.push(tr('note.hourlyTruncated', { limit: hourlyLimit }))
  }

  if (location.source === 'ip') {
    notes.push(
      tr('note.ipLocation', {
        name: location.name,
        provider: location.provider ?? 'IP',
      }),
    )
  }

  const result = {
    ok: true,
    language,
    query: { input: queryText, resolvedBy: location.source, language, units, days, date: wantedDate },
    location: {
      name: location.name,
      admin1: location.admin1 ?? null,
      country: location.country ?? null,
      countryCode: location.countryCode ?? null,
      latitude: location.latitude,
      longitude: location.longitude,
      elevation: weather.elevation ?? location.elevation ?? null,
      timezone: weather.timezone ?? location.timezone ?? null,
      provider: location.provider ?? null,
      alternatives: location.alternatives ?? [],
    },
    observedAt: weather.observedAt ?? null,
    current: weather.current,
    daily: weather.daily,
    hourly,
    hourlyDate,
    airQuality,
    unitLabels: set.labels,
    sources: [
      ...new Set(
        [
          weather.source,
          airQuality ? 'open-meteo-air-quality' : null,
          location.source === 'ip' ? location.provider ?? 'ip-location' : null,
          location.source === 'geocoding' ? 'open-meteo-geocoding' : null,
        ].filter(Boolean),
      ),
    ],
    attribution: tr('label.attribution'),
    notes,
    fetchedAt: new Date().toISOString(),
  }
  result.summary = renderWeatherText(result)
  return result
}
