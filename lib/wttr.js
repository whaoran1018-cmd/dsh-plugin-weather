/**
 * wttr.in fallback: used only when the Open-Meteo forecast endpoint fails.
 * It covers every requested field except air quality.
 */
import { getJson } from './http.js'
import { uvLevel, weatherText } from './codes.js'
import { windInfo } from './openmeteo.js'
import { resolveLanguage, t } from './i18n.js'

function num(value, digits = 1) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  const factor = 10 ** digits
  return Math.round(parsed * factor) / factor
}

function to24Hour(text) {
  const match = /^\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(String(text ?? ''))
  if (!match) return null
  let hour = Number(match[1])
  const minute = match[2]
  const meridiem = match[3]?.toUpperCase()
  if (meridiem === 'PM' && hour < 12) hour += 12
  if (meridiem === 'AM' && hour === 12) hour = 0
  return `${String(hour).padStart(2, '0')}:${minute}`
}

export async function fetchWttr(location, options) {
  const { language: rawLanguage, units, timeoutMs, cacheTtlMs, signal } = options
  const language = resolveLanguage(rawLanguage)
  const imperial = units === 'imperial'
  const url =
    `https://wttr.in/${encodeURIComponent(`${location.latitude},${location.longitude}`)}` +
    `?format=j1&lang=${language}`
  const json = await getJson(url, { timeoutMs, cacheTtlMs, signal, language })

  const cc = json?.current_condition?.[0] ?? {}
  const days = Array.isArray(json?.weather) ? json.weather : []
  const today = days[0] ?? {}
  const astronomy = today.astronomy?.[0] ?? {}

  const degrees = num(cc.winddirDegree, 0)
  const wind = windInfo(degrees, language)

  const daily = days.map((day) => {
    const dayAstro = day.astronomy?.[0] ?? {}
    const hours = Array.isArray(day.hourly) ? day.hourly : []
    const midday = hours[Math.min(4, Math.max(0, hours.length - 1))] ?? {}
    const chances = hours.map((hour) => Number(hour.chanceofrain)).filter(Number.isFinite)
    const code = Number(midday.weatherCode)
    const uv = num(day.uvIndex, 0)
    return {
      date: day.date ?? null,
      weatherCode: Number.isFinite(code) ? code : null,
      weather: weatherText(Number.isFinite(code) ? code : null, language),
      temperatureMax: num(day.maxtempC, 1),
      temperatureMin: num(day.mintempC, 1),
      apparentTemperatureMax: null,
      apparentTemperatureMin: null,
      precipitationSum: num(midday.precipMM),
      precipitationProbabilityMax: chances.length ? Math.max(...chances) : null,
      uvIndexMax: uv,
      uvLevel: uvLevel(uv, language),
      windSpeedMax: null,
      windGustsMax: null,
      windDirectionDominant: null,
      windDirectionLabel: null,
      sunrise: to24Hour(dayAstro.sunrise),
      sunset: to24Hour(dayAstro.sunset),
      daylightDuration: null,
      note: t(language, 'note.wttrPartial'),
    }
  })

  return {
    source: 'wttr.in',
    timezone: null,
    timezoneAbbreviation: null,
    utcOffsetSeconds: null,
    elevation: null,
    observedAt: cc.observation_time ? `local ${cc.observation_time}` : null,
    current: {
      time: cc.observation_time ? `local ${cc.observation_time}` : null,
      temperature: num(imperial ? cc.temp_F : cc.temp_C),
      apparentTemperature: num(imperial ? cc.FeelsLikeF : cc.FeelsLikeC),
      humidity: num(cc.humidity, 0),
      dewPoint: num(imperial ? cc.DewPointF : cc.DewPointC),
      precipitation: num(cc.precipMM),
      rain: null,
      showers: null,
      snowfall: null,
      cloudCover: num(cc.cloudcover, 0),
      pressure: num(cc.pressure, 0),
      weatherCode: Number.isFinite(Number(cc.weatherCode)) ? Number(cc.weatherCode) : null,
      weather: weatherText(Number(cc.weatherCode), language),
      isDay: true,
      uvIndex: num(cc.uvIndex, 0),
      uvLevel: uvLevel(num(cc.uvIndex, 0), language),
      windSpeed: num(imperial ? cc.windspeedMiles : cc.windspeedKmph),
      windGusts: num(imperial ? cc.WindGustMiles : cc.WindGustKmph),
      windDirectionDegrees: wind.direction.degrees,
      windDirection: { compass: wind.direction.compass, label: wind.direction.label },
      windDirectionLabel: wind.label,
      sunrise: to24Hour(astronomy.sunrise),
      sunset: to24Hour(astronomy.sunset),
      daylightDuration: null,
    },
    daily,
    hourly: [],
  }
}
