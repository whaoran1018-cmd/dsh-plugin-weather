/**
 * Human-readable rendering of a weather result.
 * Every visible string comes from the locale catalog; nothing is hard-coded here.
 */
import { weatherEmoji, weekdayName } from './codes.js'
import { resolveLanguage, t } from './i18n.js'

export function renderWeatherText(result) {
  const language = resolveLanguage(result?.query?.language)
  const tr = (key, params) => t(language, key, params)
  const dash = tr('value.dash')

  const pick = (value) => (value === null || value === undefined || value === '' ? dash : value)
  const ratio = (value) => (Number.isFinite(Number(value)) ? `${Number(value)}%` : dash)
  const suffix = (category) =>
    category?.label ? tr('row.categorySuffix', { category: category.label }) : ''

  if (!result?.ok) {
    const lines = [
      tr('summary.error', { message: result?.message ?? tr('summary.unknownError') }),
    ]
    for (const note of result?.notes ?? []) lines.push(`· ${note}`)
    for (const hint of result?.hints ?? []) lines.push(`· ${tr('summary.hint')}: ${hint}`)
    return lines.join('\n')
  }

  const loc = result.location ?? {}
  const cur = result.current ?? {}
  const units = result.unitLabels ?? {}
  const tempUnit = units.temperature ?? '°C'
  const windUnit = units.windSpeed ?? 'km/h'
  const rainUnit = units.precipitation ?? 'mm'
  const temp = (value) => (value === null || value === undefined ? dash : `${value}${tempUnit}`)
  const wind = (value) => (value === null || value === undefined ? dash : `${value} ${windUnit}`)
  const rain = (value) => (value === null || value === undefined ? dash : `${value} ${rainUnit}`)

  const place = [loc.name, loc.admin1, loc.country].filter(Boolean).join(' · ')
  const lines = []
  lines.push(`${weatherEmoji(cur.weatherCode)} ${place}`)
  lines.push(
    `📍 ${tr('row.location', {
      coords: `${loc.latitude}, ${loc.longitude}`,
      timezoneLabel: tr('label.timezone'),
      timezone: pick(loc.timezone),
      sourceLabel: tr('label.source'),
      sources: result.sources?.join(' + ') ?? dash,
    })}`,
  )
  lines.push(
    `🕐 ${tr('row.observed', {
      label: tr('label.observed'),
      time: pick(result.observedAt),
      night: cur.isDay === false ? tr('row.night') : '',
    })}`,
  )
  lines.push('')
  lines.push(`${tr('label.temp')} ${temp(cur.temperature)} · ${tr('label.feelsLike')} ${temp(cur.apparentTemperature)}`)
  lines.push(`${tr('label.humidity')} ${ratio(cur.humidity)} · ${tr('label.dewPoint')} ${temp(cur.dewPoint)}`)
  lines.push(
    tr('row.weather', {
      label: tr('label.weather'),
      weather: pick(cur.weather),
      code: cur.weatherCode === null || cur.weatherCode === undefined ? '' : tr('row.codeSuffix', { code: cur.weatherCode }),
    }) + ` · ${tr('label.cloud')} ${ratio(cur.cloudCover)}`,
  )
  lines.push(`${tr('label.precip')} ${rain(cur.precipitation)} · ${tr('label.pressure')} ${pick(cur.pressure)} ${units.pressure ?? 'hPa'}`)
  lines.push(
    tr('row.wind', {
      label: tr('label.wind'),
      direction: pick(cur.windDirectionLabel),
      speed: wind(cur.windSpeed),
      gustLabel: tr('label.gust'),
      gustSpeed: wind(cur.windGusts),
      degrees:
        cur.windDirectionDegrees === null || cur.windDirectionDegrees === undefined
          ? ''
          : `, ${cur.windDirectionDegrees}°`,
    }),
  )
  lines.push(`${tr('label.uv')} ${pick(cur.uvIndex)}${suffix(cur.uvLevel)}`)
  lines.push(
    `${tr('label.sunrise')} ${pick(cur.sunrise)} · ${tr('label.sunset')} ${pick(cur.sunset)}${
      cur.daylightDuration ? tr('row.daylight', { duration: cur.daylightDuration }) : ''
    }`,
  )

  const air = result.airQuality
  lines.push('')
  if (air) {
    lines.push(
      tr('row.airQuality', {
        label: tr('label.airQuality'),
        usAqi: pick(air.usAqi),
        usCategory: suffix(air.usAqiCategory),
        eaqiLabel: tr('label.eaqi'),
        euAqi: pick(air.europeanAqi),
        euCategory: suffix(air.europeanAqiCategory),
      }),
    )
    lines.push(
      `PM2.5 ${pick(air.pm25)} µg/m³ · PM10 ${pick(air.pm10)} µg/m³ · O₃ ${pick(air.ozone)} · NO₂ ${pick(
        air.nitrogenDioxide,
      )} · SO₂ ${pick(air.sulphurDioxide)} · CO ${pick(air.carbonMonoxide)} µg/m³`,
    )
  } else {
    lines.push(tr('row.airUnavailable', { label: tr('label.airQuality') }))
  }

  const daily = Array.isArray(result.daily) ? result.daily : []
  if (daily.length) {
    lines.push('')
    lines.push(tr('label.dailyForecast', { days: daily.length }))
    if (daily.length > 1) {
      const temps = daily
        .flatMap((day) => [day.temperatureMin, day.temperatureMax])
        .filter((value) => typeof value === 'number')
      const rainiest = daily.reduce(
        (worst, day) =>
          (day.precipitationProbabilityMax ?? -1) > (worst.precipitationProbabilityMax ?? -1) ? day : worst,
        daily[0],
      )
      const uvPeak = daily.reduce((max, day) => Math.max(max, day.uvIndexMax ?? 0), 0)
      if (temps.length) {
        lines.push(
          tr('row.trend', {
            label: tr('label.trend'),
            range: `${Math.min(...temps)}~${Math.max(...temps)}${tempUnit}`,
            date: rainiest.date,
            probability: ratio(rainiest.precipitationProbabilityMax),
            amount: rain(rainiest.precipitationSum),
            uv: uvPeak,
          }),
        )
      }
    }
    for (const day of daily) {
      lines.push(
        tr('row.daily', {
          date: day.date,
          weekday: weekdayName(day.date, language),
          emoji: weatherEmoji(day.weatherCode),
          weather: pick(day.weather),
          min: temp(day.temperatureMin),
          max: temp(day.temperatureMax),
          feelsLabel: tr('short.feels'),
          feelsMin: temp(day.apparentTemperatureMin),
          feelsMax: temp(day.apparentTemperatureMax),
          precipLabel: tr('short.precip'),
          probability: ratio(day.precipitationProbabilityMax),
          amount: rain(day.precipitationSum),
          uvLabel: tr('short.uv'),
          uv: pick(day.uvIndexMax),
          uvCategory: suffix(day.uvLevel),
          windLabel: tr('short.wind'),
          direction: pick(day.windDirectionLabel),
          speed: wind(day.windSpeedMax),
          sunriseLabel: tr('short.sunrise'),
          sunrise: pick(day.sunrise),
          sunsetLabel: tr('short.sunset'),
          sunset: pick(day.sunset),
        }),
      )
    }
  }

  const hourly = Array.isArray(result.hourly) ? result.hourly : []
  if (hourly.length) {
    lines.push('')
    lines.push(
      result.hourlyDate
        ? tr('label.hourlyDate', { date: result.hourlyDate, count: hourly.length })
        : tr('label.hourly', { count: hourly.length }),
    )
    for (const hour of hourly) {
      lines.push(
        tr('row.hourly', {
          time: String(hour.time).replace('T', ' '),
          temp: temp(hour.temperature),
          feelsLabel: tr('short.feels'),
          feels: temp(hour.apparentTemperature),
          humidityLabel: tr('short.humidity'),
          humidity: ratio(hour.humidity),
          precipLabel: tr('short.precipProbability'),
          probability: ratio(hour.precipitationProbability),
          uvLabel: tr('short.uv'),
          uv: pick(hour.uvIndex),
          windLabel: tr('short.wind'),
          speed: wind(hour.windSpeed),
        }),
      )
    }
  }

  if (result.notes?.length) {
    lines.push('')
    for (const note of result.notes) lines.push(`ℹ️ ${note}`)
  }
  lines.push('')
  lines.push(`（${result.attribution ?? tr('label.attribution')}）`)
  return lines.join('\n')
}
