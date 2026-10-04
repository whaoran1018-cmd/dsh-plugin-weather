/**
 * i18n test: every locale must mirror lib/locales/en.js exactly, and every
 * language must actually render a full summary.
 *
 *   node test/i18n-test.mjs            # + a live render in three languages
 *   node test/i18n-test.mjs --offline  # structure + fixture rendering only
 */
import en from '../lib/locales/en.js'
import { LANGUAGES, supportedLanguages, resolveLanguage, t, wmoText, uvName, aqiName, compassName, windPhrase, weekdayName } from '../lib/i18n.js'
import { renderWeatherText } from '../lib/format.js'
import { uvLevel, aqiCategory, windDirectionLabel, weatherText, weatherEmoji } from '../lib/codes.js'
import { runWeatherQuery } from '../lib/service.js'
import { resolveConfig } from '../lib/config.js'

const OFFLINE = process.argv.includes('--offline')

let passed = 0
let failed = 0
const failures = []

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✅ ${label}`)
  } else {
    failed += 1
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const enKeys = Object.keys(en)
console.log(`\n=== A. 语言文件结构（en 基准 ${enKeys.length} 键） ===`)
check('支持 9 种语言', LANGUAGES.length === 9, LANGUAGES.join(','))
check('语言顺序', LANGUAGES.join(',') === 'zh,en,es,ja,ko,pt,it,fr,de', LANGUAGES.join(','))
check('supportedLanguages() 有 9 项且带名称', supportedLanguages().length === 9 && supportedLanguages().every((l) => l.name && l.name !== l.code))

const catalogs = {}
for (const code of LANGUAGES) {
  const mod = await import(`../lib/locales/${code}.js`)
  const catalog = mod.default
  catalogs[code] = catalog
  const keys = Object.keys(catalog)
  const missing = enKeys.filter((key) => !(key in catalog))
  const extra = keys.filter((key) => !(key in en))
  check(`${code}: 键数量与 en 一致`, keys.length === enKeys.length, `${keys.length} vs ${enKeys.length}`)
  check(`${code}: 无缺失键`, missing.length === 0, missing.slice(0, 6).join(', '))
  check(`${code}: 无多余键`, extra.length === 0, extra.slice(0, 6).join(', '))
  check(`${code}: 键顺序一致`, keys.join(',') === enKeys.join(','))
  check(`${code}: code 字段正确`, catalog.code === code, String(catalog.code))
  check(`${code}: name 非空`, typeof catalog.name === 'string' && catalog.name.length > 0)
  const empties = enKeys.filter((key) => typeof catalog[key] !== 'string' || catalog[key].trim() === '')
  check(`${code}: 没有空值或非字符串`, empties.length === 0, empties.slice(0, 6).join(', '))
  const placeholderMismatch = enKeys.filter((key) => {
    const tokens = (value) => (String(value).match(/\{(\w+)\}/g) ?? []).sort().join(',')
    return tokens(en[key]) !== tokens(catalog[key])
  })
  check(`${code}: 占位符集合与 en 一致`, placeholderMismatch.length === 0, placeholderMismatch.slice(0, 6).join(', '))
}

console.log('\n=== B. 值表完整性（31 天气码 / 16 方位 / 5 紫外线 / 12 AQI / 7 星期） ===')
const WMO_CODES = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]
for (const code of LANGUAGES) {
  const missingWmo = WMO_CODES.filter((wmo) => !(`wmo.${wmo}` in catalogs[code]))
  const missingCompass = [...Array(16).keys()].filter((index) => !(`compass.${index}` in catalogs[code]))
  const missingUv = [...Array(5).keys()].filter((index) => !(`uv.${index}` in catalogs[code]))
  const missingAqi = [
    ...[...Array(6).keys()].map((index) => `aqi.us.${index}`),
    ...[...Array(6).keys()].map((index) => `aqi.eu.${index}`),
  ].filter((key) => !(key in catalogs[code]))
  check(
    `${code}: 气象码/方位/等级齐全`,
    missingWmo.length + missingCompass.length + missingUv.length + missingAqi.length === 0,
    [...missingWmo, ...missingCompass, ...missingUv, ...missingAqi].slice(0, 8).join(', '),
  )
}
check('weatherText 九种语言各不相同（以 61 为例）', new Set(LANGUAGES.map((code) => wmoText(61, code))).size === LANGUAGES.length)
check('weatherText 未知码有兜底', wmoText(1234, 'ja') !== 'wmo.1234', wmoText(1234, 'ja'))
check('uvName 5 级', [...Array(5).keys()].every((index) => uvName(index, 'de').length > 0))
check('aqiName 两套各 6 级', [...Array(6).keys()].every((index) => aqiName('us', index, 'fr').length > 0 && aqiName('eu', index, 'fr').length > 0))
check('compassName 16 方位', [...Array(16).keys()].every((index) => compassName(index, 'ko').length > 0))
check('windPhrase 中文加「风」', windPhrase(0, 'zh') === '北风', windPhrase(0, 'zh'))
check('windPhrase 日文加「の風」', windPhrase(0, 'ja') === '北の風', windPhrase(0, 'ja'))
check('windPhrase 英文不加后缀', windPhrase(0, 'en') === 'North', windPhrase(0, 'en'))
check('weekdayName 7 天', [...Array(7).keys()].every((index) => weekdayName(index, 'es').length > 0))

console.log('\n=== C. 语言解析与兜底 ===')
check("resolveLanguage('zh-CN') = zh", resolveLanguage('zh-CN') === 'zh')
check("resolveLanguage('PT_br') = pt", resolveLanguage('PT_br') === 'pt')
check("resolveLanguage('JA') = ja", resolveLanguage('JA') === 'ja')
check("resolveLanguage('de-DE') = de", resolveLanguage('de-DE') === 'de')
check("resolveLanguage('xx') → en", resolveLanguage('xx') === 'en')
check('resolveLanguage(undefined) → en', resolveLanguage(undefined) === 'en')
check('缺词回退到英文', t('ja', 'no.such.key') === 'no.such.key')
check('t() 插值', t('es', 'summary.error', { message: 'X' }).includes('X'))

console.log('\n=== D. 九种语言整段渲染（fixture） ===')
function fixture(language) {
  const uv = uvLevel(0, language)
  return {
    ok: true,
    language,
    query: { input: 'Shanghai', language },
    location: { name: 'Shanghai', admin1: 'Shanghai', country: 'China', latitude: 31.22, longitude: 121.47, timezone: 'Asia/Shanghai' },
    observedAt: '2026-10-05T00:45',
    current: {
      temperature: 19.6, apparentTemperature: 20.3, humidity: 84, dewPoint: 16.9, precipitation: 0,
      cloudCover: 100, pressure: 1018.5, weatherCode: 3, weather: weatherText(3, language), isDay: false,
      uvIndex: 0, uvLevel: uv, windSpeed: 11.9, windGusts: 26.3, windDirectionDegrees: 350,
      windDirectionLabel: windDirectionLabel(350, language), sunrise: '05:50', sunset: '17:34', daylightDuration: '11h45m',
    },
    daily: [
      {
        date: '2026-10-05', weatherCode: 3, weather: weatherText(3, language), temperatureMin: 16.3, temperatureMax: 22.2,
        apparentTemperatureMin: 15.9, apparentTemperatureMax: 21.7, precipitationSum: 0, precipitationProbabilityMax: 12,
        uvIndexMax: 6.4, uvLevel: uvLevel(6.4, language), windDirectionLabel: windDirectionLabel(342, language),
        windSpeedMax: 15.8, sunrise: '05:50', sunset: '17:34',
      },
      {
        date: '2026-10-06', weatherCode: 0, weather: weatherText(0, language), temperatureMin: 13.4, temperatureMax: 21.9,
        apparentTemperatureMin: 12, apparentTemperatureMax: 21.3, precipitationSum: 0, precipitationProbabilityMax: 0,
        uvIndexMax: 6.6, uvLevel: uvLevel(6.6, language), windDirectionLabel: windDirectionLabel(318, language),
        windSpeedMax: 11.5, sunrise: '05:50', sunset: '17:33',
      },
    ],
    hourly: [
      { time: '2026-10-05T13:00', temperature: 21.9, apparentTemperature: 22.7, humidity: 41, precipitationProbability: 0, uvIndex: 5.1, windSpeed: 4.4 },
    ],
    hourlyDate: '2026-10-05',
    airQuality: {
      usAqi: 72, usAqiCategory: aqiCategory(72, 'us', language), europeanAqi: 57,
      europeanAqiCategory: aqiCategory(57, 'eu', language), pm25: 32.4, pm10: 37.7, ozone: 32,
      nitrogenDioxide: 54.7, sulphurDioxide: 14.2, carbonMonoxide: 251,
    },
    unitLabels: { temperature: '°C', windSpeed: 'km/h', precipitation: 'mm', pressure: 'hPa' },
    sources: ['open-meteo', 'open-meteo-air-quality'],
    attribution: t(language, 'label.attribution'),
    notes: [],
  }
}

for (const code of LANGUAGES) {
  const summary = renderWeatherText(fixture(code))
  // Templates are compared by the text before their first placeholder.
  const prefix = (key) => t(code, key).split('{')[0].trim()
  const required = ['label.temp', 'label.feelsLike', 'label.humidity', 'label.uv', 'label.sunrise', 'label.airQuality', 'label.wind']
  const missing = required.filter((key) => !summary.includes(t(code, key)))
  const missingTemplates = ['label.dailyForecast', 'label.hourlyDate'].filter((key) => !summary.includes(prefix(key)))
  check(`${code}: 摘要含全部本地化标签`, missing.length === 0 && missingTemplates.length === 0, [...missing, ...missingTemplates].join(', '))
  check(`${code}: 摘要无未翻译键名`, !/(^|\s)(wmo|label|row|short|aqi|uv)\.\w/.test(summary))
  check(`${code}: 摘要无 undefined/null`, !/undefined|null/.test(summary))
  const englishLeak = code !== 'en' && t(code, 'label.humidity') !== t('en', 'label.humidity') && summary.includes(t('en', 'label.humidity'))
  check(`${code}: 无英文串味`, englishLeak === false)
  // Daily rows are the only ones carrying the sunrise label (hourly has none).
  const dailyLines = summary
    .split('\n')
    .filter((line) => /^2026-10-0\d /.test(line) && line.includes(t(code, 'short.sunrise')))
  check(`${code}: 逐日两行都在`, dailyLines.length === 2, String(dailyLines.length))
  check(`${code}: 逐时一节在`, summary.includes(prefix('label.hourlyDate')))
}

const errorSummary = renderWeatherText({ ok: false, message: 'boom', query: { language: 'ko' }, notes: ['note'], hints: [t('ko', 'hint.network')] })
check('错误摘要本地化', errorSummary.includes(t('ko', 'summary.error').split('{message}')[0].trim()), errorSummary.split('\n')[0])
check('错误摘要含 hint 标签', errorSummary.includes(t('ko', 'summary.hint')))

if (OFFLINE) {
  console.log('\n=== E. 联网多语言渲染 === 已跳过（--offline）')
} else {
  console.log('\n=== E. 联网多语言渲染 ===')
  const cfg = resolveConfig({})
  for (const code of ['zh', 'ja', 'es']) {
    const result = await runWeatherQuery({ location: 'Shanghai', days: 1, language: code }, cfg, {})
    check(`${code}: 实况调用 ok`, result?.ok === true, JSON.stringify(result?.message ?? ''))
    check(`${code}: summary 用该语言`, typeof result?.summary === 'string' && result.summary.includes(t(code, 'label.temp')), String(result?.summary ?? '').slice(0, 60))
    check(`${code}: query.language 回显`, result?.query?.language === code, String(result?.query?.language))
    check(`${code}: 空气质量等级已本地化`, result?.airQuality?.usAqiCategory?.label === aqiCategory(result?.airQuality?.usAqi, 'us', code)?.label)
  }
  const override = await runWeatherQuery({ location: 'Shanghai', days: 1, language: 'de' }, resolveConfig({ language: 'zh' }), {})
  check('per-call language 覆盖 config', override?.summary?.includes(t('de', 'label.temp')), String(override?.summary ?? '').slice(0, 60))
  const badLanguage = await runWeatherQuery({ location: 'Shanghai', days: 0, language: 'klingon' }, cfg, {})
  check('非法语言回退到英文', badLanguage?.summary?.includes(t('en', 'label.temp')), String(badLanguage?.summary ?? '').slice(0, 60))
}

console.log(`\n=== 结果：${passed} 通过 / ${failed} 失败 ===`)
if (failures.length) {
  console.log('\n失败明细：')
  for (const item of failures) console.log(`  · ${item}`)
}
process.exit(failed ? 1 : 0)
