/** Orchestration: resolve the place, fetch weather (+ air quality), summarize. */
import { resolveLocation } from './geo.js'
import { fetchAirQuality, fetchForecast, unitSet } from './openmeteo.js'
import { fetchWttr } from './wttr.js'
import { renderWeatherText } from './format.js'

export function errorMessage(error) {
  if (error instanceof Error) return error.message
  return String(error ?? 'unknown error')
}

export function clampInt(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

export function describeQuery(args) {
  const input = args && typeof args === 'object' ? args : {}
  const latitude = Number(input.latitude)
  const longitude = Number(input.longitude)
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) return `${latitude},${longitude}`
  if (typeof input.location === 'string' && input.location.trim()) return input.location.trim()
  return '自动定位'
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
  const units = input.units === 'imperial' ? 'imperial' : input.units === 'metric' ? 'metric' : cfg.units
  const set = unitSet(units)
  const language = cfg.language
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
    location = await resolveLocation(input, { ...cfg, signal: exec?.signal })
  } catch (error) {
    return failure(`定位失败：${errorMessage(error)}`, {
      query: { input: describeQuery(input), language, units },
      hints: [
        '可以直接给 "纬度,经度"（如 31.23,121.47）。',
        '或在插件配置 defaultLocation 里写死默认地点。',
      ],
    })
  }

  const notes = []
  let weather = null
  try {
    weather = await fetchForecast(location, { ...callOptions, days, includeHourly })
  } catch (error) {
    notes.push(`Open-Meteo 天气接口失败：${errorMessage(error)}`)
    if (cfg.provider === 'auto') {
      try {
        weather = await fetchWttr(location, callOptions)
        notes.push('已回退到 wttr.in 数据源（字段较少，且不含空气质量）。')
      } catch (fallbackError) {
        notes.push(`wttr.in 回退也失败：${errorMessage(fallbackError)}`)
      }
    }
  }

  if (!weather) {
    return failure(`无法获取天气数据：${notes.join('；')}`, {
      query: { input: describeQuery(input), language, units },
      location: { name: location.name, latitude: location.latitude, longitude: location.longitude },
      notes,
      hints: ['检查网络（api.open-meteo.com / wttr.in）后重试。'],
    })
  }

  // A chosen date beyond the current window: widen once to the 16-day maximum.
  const lastForecastDate = weather.daily?.at(-1)?.date ?? null
  if (wantedDate && lastForecastDate && wantedDate > lastForecastDate && days < 16) {
    try {
      weather = await fetchForecast(location, { ...callOptions, days: 16, includeHourly: true })
      notes.push(`日期 ${wantedDate} 超出默认窗口，已把预报范围扩展到 16 天。`)
    } catch (error) {
      notes.push(`扩展预报范围失败：${errorMessage(error)}`)
    }
  }

  let airQuality = null
  if (includeAirQuality) {
    try {
      airQuality = await fetchAirQuality(location, callOptions)
    } catch (error) {
      notes.push(`空气质量接口失败：${errorMessage(error)}`)
    }
  }

  let hourly = Array.isArray(weather.hourly) ? weather.hourly : []
  const hourlyLimit = options.hourlyLimit ?? 48
  let hourlyDate = null
  if (wantedDate) {
    const dayRows = hourly.filter((row) => String(row.time ?? '').startsWith(wantedDate))
    if (dayRows.length) {
      hourly = dayRows
      hourlyDate = wantedDate
      const firstDate = weather.daily?.[0]?.date ?? null
      const lastDate = weather.daily?.at(-1)?.date ?? null
      if (!firstDate || wantedDate < firstDate) {
        notes.push(`${wantedDate} 早于本次预报窗口${firstDate ? `（${firstDate} ~ ${lastDate}）` : ''}，返回的是该日在接口里仅存的历史/当前小时。`)
      }
    } else {
      const firstDate = weather.daily?.[0]?.date ?? '?'
      const lastDate = weather.daily?.at(-1)?.date ?? '?'
      notes.push(`date=${wantedDate} 不在预报窗口（${firstDate} ~ ${lastDate}）内，已改为返回从当前时刻起的逐时。`)
      hourly = hourly.slice(0, hourlyLimit)
    }
  } else if (hourly.length > hourlyLimit) {
    hourly = hourly.slice(0, hourlyLimit)
    notes.push(`逐时数据已截断为前 ${hourlyLimit} 小时（要指定某一天请传 date）。`)
  }

  if (location.source === 'ip') {
    notes.push(
      `未指定地点，已按公网 IP（${location.provider ?? 'IP 定位'}）取「${location.name}」；` +
        'IP 定位可能与实际所在城市不同，需要精确结果请显式给 location 或坐标。',
    )
  }

  const result = {
    ok: true,
    query: { input: describeQuery(input), resolvedBy: location.source, language, units, days, date: wantedDate },
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
    attribution: '天气与环境数据 © Open-Meteo (CC BY 4.0)',
    notes,
    fetchedAt: new Date().toISOString(),
  }
  result.summary = renderWeatherText(result)
  return result
}
