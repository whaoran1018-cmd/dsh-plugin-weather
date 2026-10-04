/** Human-readable rendering of a weather result (zh / en). */
import { weatherEmoji, weekdayName } from './codes.js'

function pick(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback
  return value
}

function ratio(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${n}%`
}

function level(category, zh) {
  if (!category) return ''
  const label = zh ? category.zh : category.en
  return label ? `（${label}）` : ''
}

export function renderWeatherText(result) {
  const zh = (result?.query?.language ?? 'zh') !== 'en'
  if (!result?.ok) {
    const lines = [`⚠️ ${zh ? '天气查询失败' : 'Weather lookup failed'}：${result?.message ?? 'unknown error'}`]
    for (const note of result?.notes ?? []) lines.push(`· ${note}`)
    for (const hint of result?.hints ?? []) lines.push(`· ${zh ? '建议' : 'Hint'}：${hint}`)
    return lines.join('\n')
  }

  const loc = result.location ?? {}
  const cur = result.current ?? {}
  const units = result.unitLabels ?? {}
  const tempUnit = units.temperature ?? '°C'
  const windUnit = units.windSpeed ?? 'km/h'
  const rainUnit = units.precipitation ?? 'mm'
  const t = (value) => (value === null || value === undefined ? '—' : `${value}${tempUnit}`)
  const w = (value) => (value === null || value === undefined ? '—' : `${value} ${windUnit}`)
  const r = (value) => (value === null || value === undefined ? '—' : `${value} ${rainUnit}`)

  const place = [loc.name, loc.admin1, loc.country].filter(Boolean).join(' · ')
  const lines = []
  lines.push(`${weatherEmoji(cur.weatherCode)} ${place}${zh ? '' : ''}`)
  lines.push(
    `📍 ${loc.latitude}, ${loc.longitude} · ${zh ? '时区' : 'Timezone'} ${pick(loc.timezone, '—')} · ${
      zh ? '数据源' : 'Source'
    } ${result.sources?.join(' + ') ?? '—'}`,
  )
  lines.push(
    `🕐 ${zh ? '观测' : 'Observed'} ${pick(result.observedAt)}${cur.isDay === false ? (zh ? '（夜间）' : ' (night)') : ''}`,
  )
  lines.push('')
  lines.push(`${zh ? '温度' : 'Temp'} ${t(cur.temperature)} · ${zh ? '体感' : 'Feels like'} ${t(cur.apparentTemperature)}`)
  lines.push(`${zh ? '湿度' : 'Humidity'} ${ratio(cur.humidity)} · ${zh ? '露点' : 'Dew point'} ${t(cur.dewPoint)}`)
  lines.push(
    `${zh ? '天气' : 'Weather'} ${pick(cur.weather)}${cur.weatherCode === null ? '' : `（code ${cur.weatherCode}）`} · ${
      zh ? '云量' : 'Cloud'
    } ${ratio(cur.cloudCover)}`,
  )
  lines.push(
    `${zh ? '降水' : 'Precip'} ${r(cur.precipitation)} · ${zh ? '气压' : 'Pressure'} ${pick(cur.pressure)} ${
      units.pressure ?? 'hPa'
    }`,
  )
  lines.push(
    `${zh ? '风' : 'Wind'} ${pick(cur.windDirectionLabel, '—')} ${w(cur.windSpeed)}（${
      zh ? '阵风' : 'gust'
    } ${w(cur.windGusts)}${cur.windDirectionDegrees === null ? '' : `, ${cur.windDirectionDegrees}°`}）`,
  )
  lines.push(`${zh ? '紫外线' : 'UV index'} ${pick(cur.uvIndex)}${level(cur.uvLevel, zh)}`)
  lines.push(
    `${zh ? '日出' : 'Sunrise'} ${pick(cur.sunrise)} · ${zh ? '日落' : 'Sunset'} ${pick(cur.sunset)}${
      cur.daylightDuration ? `（${zh ? '白昼' : 'daylight'} ${cur.daylightDuration}）` : ''
    }`,
  )

  const air = result.airQuality
  lines.push('')
  if (air) {
    lines.push(
      `${zh ? '空气质量' : 'Air quality'}：US AQI ${pick(air.usAqi)}${level(air.usAqiCategory, zh)} · ${
        zh ? '欧洲 AQI' : 'EAQI'
      } ${pick(air.europeanAqi)}${level(air.europeanAqiCategory, zh)}`,
    )
    lines.push(
      `PM2.5 ${pick(air.pm25)} µg/m³ · PM10 ${pick(air.pm10)} µg/m³ · O₃ ${pick(air.ozone)} · NO₂ ${pick(
        air.nitrogenDioxide,
      )} · SO₂ ${pick(air.sulphurDioxide)} · CO ${pick(air.carbonMonoxide)} µg/m³`,
    )
  } else {
    lines.push(`${zh ? '空气质量' : 'Air quality'}：${zh ? '未获取' : 'unavailable'}`)
  }

  const daily = Array.isArray(result.daily) ? result.daily : []
  if (daily.length) {
    lines.push('')
    lines.push(zh ? `逐日预报（${daily.length} 天，当地日期）` : `Daily forecast (${daily.length} days, local)`)
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
          `${zh ? '趋势' : 'Trend'}：${Math.min(...temps)}~${Math.max(...temps)}${tempUnit} · ` +
            `${zh ? '最湿' : 'wettest'} ${rainiest.date}（${ratio(rainiest.precipitationProbabilityMax)} / ${r(
              rainiest.precipitationSum,
            )}） · ${zh ? '紫外线峰值' : 'UV peak'} ${uvPeak}`,
        )
      }
    }
    for (const day of daily) {
      const weekday = weekdayName(day.date, zh ? 'zh' : 'en')
      lines.push(
        `${day.date} ${weekday}  ${weatherEmoji(day.weatherCode)} ${pick(day.weather)}  ` +
          `${t(day.temperatureMin)}~${t(day.temperatureMax)}  体感 ${t(day.apparentTemperatureMin)}~${t(
            day.apparentTemperatureMax,
          )}  ` +
          `降水 ${ratio(day.precipitationProbabilityMax)}/${r(day.precipitationSum)}  ` +
          `紫外线 ${pick(day.uvIndexMax)}${level(day.uvLevel, zh)}  ` +
          `风 ${pick(day.windDirectionLabel, '—')} ${w(day.windSpeedMax)}  ` +
          `日出 ${pick(day.sunrise)} / 日落 ${pick(day.sunset)}`,
      )
    }
  }

  const hourly = Array.isArray(result.hourly) ? result.hourly : []
  if (hourly.length) {
    lines.push('')
    lines.push(
      result.hourlyDate
        ? zh
          ? `逐时 · ${result.hourlyDate}（当地时，${hourly.length} 条）`
          : `Hourly · ${result.hourlyDate} (local, ${hourly.length} rows)`
        : zh
          ? `逐时（当地时，共 ${hourly.length} 条）`
          : `Hourly (local, ${hourly.length} rows)`,
    )
    for (const hour of hourly) {
      lines.push(
        `${String(hour.time).replace('T', ' ')}  ${t(hour.temperature)}  体感 ${t(hour.apparentTemperature)}  ` +
          `湿度 ${ratio(hour.humidity)}  降水概率 ${ratio(hour.precipitationProbability)}  ` +
          `紫外线 ${pick(hour.uvIndex)}  风 ${w(hour.windSpeed)}`,
      )
    }
  }

  if (result.notes?.length) {
    lines.push('')
    for (const note of result.notes) lines.push(`ℹ️ ${note}`)
  }
  lines.push('')
  lines.push(`（${result.attribution ?? 'Open-Meteo'}）`)
  return lines.join('\n')
}
