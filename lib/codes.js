/** WMO weather codes, compass points, UV levels and AQI categories (zh + en). */

const WMO = {
  0: ['晴', 'Clear sky'],
  1: ['大部晴朗', 'Mainly clear'],
  2: ['局部多云', 'Partly cloudy'],
  3: ['阴', 'Overcast'],
  45: ['雾', 'Fog'],
  48: ['雾凇（沉积雾）', 'Depositing rime fog'],
  51: ['小毛毛雨', 'Light drizzle'],
  53: ['毛毛雨', 'Moderate drizzle'],
  55: ['大毛毛雨', 'Dense drizzle'],
  56: ['轻度冻毛毛雨', 'Light freezing drizzle'],
  57: ['强冻毛毛雨', 'Dense freezing drizzle'],
  61: ['小雨', 'Slight rain'],
  63: ['中雨', 'Moderate rain'],
  65: ['大雨', 'Heavy rain'],
  66: ['轻度冻雨', 'Light freezing rain'],
  67: ['强冻雨', 'Heavy freezing rain'],
  71: ['小雪', 'Slight snow'],
  73: ['中雪', 'Moderate snow'],
  75: ['大雪', 'Heavy snow'],
  77: ['雪粒', 'Snow grains'],
  80: ['小阵雨', 'Slight rain showers'],
  81: ['中阵雨', 'Moderate rain showers'],
  82: ['强阵雨', 'Violent rain showers'],
  85: ['小阵雪', 'Slight snow showers'],
  86: ['大阵雪', 'Heavy snow showers'],
  95: ['雷阵雨', 'Thunderstorm'],
  96: ['雷阵雨伴小冰雹', 'Thunderstorm with slight hail'],
  99: ['雷阵雨伴大冰雹', 'Thunderstorm with heavy hail'],
}

export function weatherText(code, language = 'zh') {
  if (code === null || code === undefined) return language === 'en' ? 'Unknown' : '未知'
  const entry = WMO[Number(code)]
  if (!entry) return `${language === 'en' ? 'Weather code' : '天气代码'} ${code}`
  return language === 'en' ? entry[1] : entry[0]
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

const COMPASS = [
  ['北', 'N'], ['东北偏北', 'NNE'], ['东北', 'NE'], ['东北偏东', 'ENE'],
  ['东', 'E'], ['东南偏东', 'ESE'], ['东南', 'SE'], ['东南偏南', 'SSE'],
  ['南', 'S'], ['西南偏南', 'SSW'], ['西南', 'SW'], ['西南偏西', 'WSW'],
  ['西', 'W'], ['西北偏西', 'WNW'], ['西北', 'NW'], ['西北偏北', 'NNW'],
]

export function windCompass(degrees) {
  const d = Number(degrees)
  if (!Number.isFinite(d)) return null
  const index = Math.round((((d % 360) + 360) % 360) / 22.5) % 16
  return { index, zh: COMPASS[index][0], en: COMPASS[index][1] }
}

const UV_LEVELS = [
  [2, '低', 'Low'],
  [5, '中等', 'Moderate'],
  [7, '高', 'High'],
  [10, '很高', 'Very high'],
  [Infinity, '极高', 'Extreme'],
]

export function uvLevel(value) {
  const v = Number(value)
  if (!Number.isFinite(v)) return null
  const found = UV_LEVELS.find(([max]) => v <= max)
  return { zh: found[1], en: found[2] }
}

const US_AQI = [
  [50, '优', 'Good'],
  [100, '中等', 'Moderate'],
  [150, '对敏感人群不健康', 'Unhealthy for sensitive groups'],
  [200, '不健康', 'Unhealthy'],
  [300, '非常不健康', 'Very unhealthy'],
  [Infinity, '危险', 'Hazardous'],
]

const EU_AQI = [
  [20, '优', 'Good'],
  [40, '良', 'Fair'],
  [60, '中等', 'Moderate'],
  [80, '差', 'Poor'],
  [100, '很差', 'Very poor'],
  [Infinity, '极差', 'Extremely poor'],
]

export function aqiCategory(value, scale = 'us') {
  const v = Number(value)
  if (!Number.isFinite(v)) return null
  const table = scale === 'eu' ? EU_AQI : US_AQI
  const found = table.find(([max]) => v <= max)
  return { zh: found[1], en: found[2] }
}

export function weekdayName(dateString, language = 'zh') {
  const date = new Date(`${dateString}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return ''
  const names = language === 'en'
    ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    : ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return names[date.getUTCDay()]
}
