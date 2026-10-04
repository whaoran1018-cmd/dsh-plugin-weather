/**
 * Self-test for dsh-plugin-weather.
 *
 *   node test/selftest.mjs            # Part A + Part B (needs network)
 *   node test/selftest.mjs --offline  # Part A only (CI / no network)
 *
 * Part A (offline): plugin contract, tool registration against a mock ctx, and
 *                   the DSH tool-schema subset that decides whether the host
 *                   activates the plugin row at all.
 * Part B (online):  live Open-Meteo calls covering every field the plugin
 *                   promises (temperature, humidity, feels-like, UV,
 *                   sunrise/sunset, wind, air quality), multi-day forecast,
 *                   a chosen date's hourly rows, and the error paths.
 */
import { apply, inject, name as pluginName, Config } from '../lib/index.js'
import { resolveConfig } from '../lib/config.js'

const OFFLINE = process.argv.includes('--offline') || process.env.WEATHER_TEST_OFFLINE === '1'

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

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

console.log('\n=== A. 契约与注册（离线） ===')
check('plugin name', pluginName === 'dsh-plugin-weather', pluginName)
check('inject 声明 tools', Array.isArray(inject) && inject.includes('tools'))
check('导出 Config（schemastery schema）', typeof Config === 'function' || typeof Config === 'object')
const configDefaults = typeof Config === 'function' ? Config({}) : {}
check(
  'Config 默认值可用',
  configDefaults.language === 'en' &&
    configDefaults.units === 'metric' &&
    configDefaults.includeAirQuality === true &&
    configDefaults.requestTimeoutMs >= 1000,
  JSON.stringify(configDefaults),
)
check('apply 是函数', typeof apply === 'function')

const registered = []
const mockCtx = { tools: { register: (definition) => (registered.push(definition), () => {}) } }
apply(mockCtx, resolveConfig({ language: 'zh' }))

const byName = Object.fromEntries(registered.map((tool) => [tool.name, tool]))
check('注册 2 个工具', registered.length === 2, registered.map((t) => t.name).join(','))
check('get_weather 存在', Boolean(byName.get_weather))
check('get_weather_forecast 存在', Boolean(byName.get_weather_forecast))

for (const tool of registered) {
  check(`${tool.name}: 有 description`, typeof tool.description === 'string' && tool.description.length > 40)
  check(`${tool.name}: parameters 是 object schema`, tool.parameters?.type === 'object')
  check(`${tool.name}: output.schema + render`, Boolean(tool.output?.schema) && typeof tool.output?.render === 'function')
  check(`${tool.name}: execute 是函数`, typeof tool.execute === 'function')
  check(`${tool.name}: 并行安全`, tool.isConcurrencySafe?.() === true)
  const blocks = tool.output.render({}, { ok: true, summary: '摘要', current: {} })
  check(`${tool.name}: render 返回文本块`, Array.isArray(blocks) && blocks.every((b) => b.type === 'text' && typeof b.text === 'string'))
}

const getWeather = byName.get_weather
const getForecast = byName.get_weather_forecast

/**
 * Mirror of DSH's `assertSupportedJsonSchema` subset (extracted from
 * @deepseek-ai/dsh-tools): type/oneOf/properties/required/additionalProperties/
 * items/enum/const + annotations (description/title/default/examples).
 * A tool definition outside this subset makes the loader fail the whole plugin.
 */
const CONSTRAINT_KEYWORDS = new Set([
  'type',
  'oneOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
])
const ANNOTATION_KEYWORDS = new Set(['description', 'title', 'default', 'examples'])
const ONE_OF_SIBLINGS = ['properties', 'required', 'additionalProperties', 'items', 'enum', 'const']
const SCHEMA_TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']
const TYPE_ONLY_KEYWORDS = {
  properties: ['object'],
  required: ['object'],
  additionalProperties: ['object'],
  items: ['array'],
  enum: ['string', 'number', 'integer', 'boolean', 'null'],
  const: ['string', 'number', 'integer', 'boolean', 'null'],
}

function schemaViolations(node, path, out) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    out.push(`${path} must be a schema object`)
    return
  }
  for (const key of Object.keys(node)) {
    if (CONSTRAINT_KEYWORDS.has(key) || ANNOTATION_KEYWORDS.has(key)) continue
    out.push(`${path}.${key} is not a supported keyword`)
  }
  const hasType = Object.hasOwn(node, 'type')
  const hasOneOf = Object.hasOwn(node, 'oneOf')
  if (hasType && hasOneOf) {
    out.push(`${path} cannot declare both type and oneOf`)
    return
  }
  if (!hasType && !hasOneOf) {
    for (const key of ONE_OF_SIBLINGS) if (Object.hasOwn(node, key)) out.push(`${path}.${key} requires type or oneOf`)
    return
  }
  if (hasOneOf) {
    if (!Array.isArray(node.oneOf) || node.oneOf.length < 2) {
      out.push(`${path}.oneOf must be an array of at least two schemas`)
      return
    }
    for (const key of ONE_OF_SIBLINGS) if (Object.hasOwn(node, key)) out.push(`${path}.${key} is not supported beside oneOf`)
    node.oneOf.forEach((entry, index) => schemaViolations(entry, `${path}.oneOf[${index}]`, out))
    return
  }
  if (typeof node.type !== 'string' || !SCHEMA_TYPES.includes(node.type)) {
    out.push(`${path}.type must be one of ${SCHEMA_TYPES.join('/')}`)
    return
  }
  for (const [key, allowed] of Object.entries(TYPE_ONLY_KEYWORDS)) {
    if (Object.hasOwn(node, key) && !allowed.includes(node.type)) out.push(`${path}.${key} is not supported on type "${node.type}"`)
  }
  if (Object.hasOwn(node, 'description') && typeof node.description !== 'string') out.push(`${path}.description must be a string`)
  if (Object.hasOwn(node, 'title') && typeof node.title !== 'string') out.push(`${path}.title must be a string`)
  if (node.type === 'object') {
    if (Object.hasOwn(node, 'additionalProperties') && typeof node.additionalProperties !== 'boolean') {
      out.push(`${path}.additionalProperties must be a boolean`)
    }
    if (Object.hasOwn(node, 'required')) {
      if (!Array.isArray(node.required) || node.required.some((entry) => typeof entry !== 'string')) {
        out.push(`${path}.required must be an array of strings`)
      } else {
        const declared = node.properties && typeof node.properties === 'object' ? node.properties : {}
        for (const key of node.required) if (!Object.hasOwn(declared, key)) out.push(`${path}.required names "${key}" which is not in properties`)
      }
    }
    if (Object.hasOwn(node, 'properties')) {
      if (node.properties === null || typeof node.properties !== 'object' || Array.isArray(node.properties)) {
        out.push(`${path}.properties must be an object of schemas`)
      } else {
        for (const [key, value] of Object.entries(node.properties)) schemaViolations(value, `${path}.properties.${key}`, out)
      }
    }
  }
  if (node.type === 'array' && Object.hasOwn(node, 'items')) schemaViolations(node.items, `${path}.items`, out)
}

function assertToolSchemaSubset(tool) {
  const violations = []
  schemaViolations(tool.parameters, `${tool.name}.parameters`, violations)
  schemaViolations(tool.output?.schema, `${tool.name}.output.schema`, violations)
  check(`${tool.name}: schema 属于 DSH 支持子集`, violations.length === 0, violations.join('; '))
}

for (const tool of registered) assertToolSchemaSubset(tool)


const CURRENT_FIELDS = [
  'temperature',
  'apparentTemperature',
  'humidity',
  'dewPoint',
  'precipitation',
  'cloudCover',
  'pressure',
  'uvIndex',
  'windSpeed',
  'windGusts',
  'windDirectionDegrees',
  'sunrise',
  'sunset',
]

const AIR_FIELDS = [
  'usAqi',
  'europeanAqi',
  'pm25',
  'pm10',
  'ozone',
  'nitrogenDioxide',
  'sulphurDioxide',
  'carbonMonoxide',
]

function assertCurrent(label, result) {
  check(`${label}: ok=true`, result?.ok === true, JSON.stringify(result?.message ?? ''))
  check(`${label}: summary 非空`, typeof result?.summary === 'string' && result.summary.length > 40)
  check(`${label}: 地点解析`, typeof result?.location?.name === 'string' && result.location.name.length > 0)
  check(`${label}: 经纬度`, isNumber(result?.location?.latitude) && isNumber(result?.location?.longitude))
  check(`${label}: 时区`, typeof result?.location?.timezone === 'string' && result.location.timezone.includes('/'))
  for (const field of CURRENT_FIELDS) {
    check(`${label}: current.${field}`, isNumber(result?.current?.[field]) || typeof result?.current?.[field] === 'string')
  }
  // 温湿度、体感、紫外线、风速在物理上必须非零/有意义
  check(`${label}: 体感温度不等于 null`, result?.current?.apparentTemperature !== null)
  check(`${label}: 湿度 0-100`, result?.current?.humidity >= 0 && result?.current?.humidity <= 100)
  check(`${label}: 紫外线 >= 0`, result?.current?.uvIndex >= 0)
  check(`${label}: 风速 >= 0`, result?.current?.windSpeed >= 0)
  check(`${label}: 风向描述`, typeof result?.current?.windDirectionLabel === 'string' && result.current.windDirectionLabel.length > 0)
  check(`${label}: 日出/日落格式 HH:MM`, /^\d{2}:\d{2}$/.test(result?.current?.sunrise ?? '') && /^\d{2}:\d{2}$/.test(result?.current?.sunset ?? ''))
  check(`${label}: 天气现象`, typeof result?.current?.weather === 'string' && result.current.weather.length > 0)
  check(`${label}: 空气质量齐全`, Boolean(result?.airQuality))
  for (const field of AIR_FIELDS) {
    check(`${label}: airQuality.${field}`, isNumber(result?.airQuality?.[field]), String(result?.airQuality?.[field]))
  }
  check(`${label}: AQI 分级`, typeof result?.airQuality?.usAqiCategory?.label === 'string' && typeof result?.airQuality?.usAqiCategory?.key === 'string')
  check(`${label}: 风向含稳定缩写 + 本地化名`, typeof result?.current?.windDirection?.compass === 'string' && typeof result?.current?.windDirection?.label === 'string')
  check(`${label}: 紫外线等级含 key + label`, typeof result?.current?.uvLevel?.key === 'string' && typeof result?.current?.uvLevel?.label === 'string')
  check(`${label}: JSON 可序列化`, (() => { try { JSON.parse(JSON.stringify(result)); return true } catch { return false } })())
}

const exec = {}

if (OFFLINE) {
  console.log('\n=== B. 实时数据（联网） === 已跳过（--offline）')
} else {
console.log('\n=== B. 实时数据（联网） ===')

try {
  console.log('\n-- B1. 中文城市名：上海（含 3 天逐日） --')
  const shanghai = await getWeather.execute({ location: '上海', days: 3 }, exec)
  assertCurrent('上海', shanghai)
  check('上海: 解析到中国', shanghai?.location?.countryCode === 'CN', String(shanghai?.location?.countryCode))
  check('上海: 时区 Asia/Shanghai', shanghai?.location?.timezone === 'Asia/Shanghai', String(shanghai?.location?.timezone))
  check('上海: 3 天逐日', shanghai?.daily?.length === 3, String(shanghai?.daily?.length))
  const day = shanghai?.daily?.[0]
  check('上海: 逐日含日出日落', /^\d{2}:\d{2}$/.test(day?.sunrise ?? '') && /^\d{2}:\d{2}$/.test(day?.sunset ?? ''))
  check('上海: 逐日含紫外线最大值', isNumber(day?.uvIndexMax))
  check('上海: 逐日含降水概率', isNumber(day?.precipitationProbabilityMax))
  check('上海: 逐日内含体感温度', isNumber(day?.apparentTemperatureMax) && isNumber(day?.apparentTemperatureMin))
  check('上海: sources 含 open-meteo', shanghai?.sources?.includes('open-meteo'))

  console.log('\n-- B2. 全球城市（英文）：Jakarta --')
  const jakarta = await getForecast.execute({ location: 'Jakarta', days: 5 }, exec)
  assertCurrent('Jakarta', jakarta)
  check('Jakarta: 5 天逐日', jakarta?.daily?.length === 5, String(jakarta?.daily?.length))
  check('Jakarta: 时区 Asia/Jakarta', jakarta?.location?.timezone === 'Asia/Jakarta', String(jakarta?.location?.timezone))

  console.log('\n-- B3. 直接坐标：31.23,121.47 --')
  const coords = await getWeather.execute({ latitude: 31.23, longitude: 121.47, days: 0 }, exec)
  assertCurrent('坐标', coords)
  check('坐标: days=0 只给今天', coords?.daily?.length === 1, String(coords?.daily?.length))

  console.log('\n-- B4. 英制单位：New York + imperial --')
  const ny = await getWeather.execute({ location: 'New York', units: 'imperial', days: 1 }, exec)
  assertCurrent('New York', ny)
  check('New York: 单位为 °F', ny?.unitLabels?.temperature === '°F', String(ny?.unitLabels?.temperature))
  check('New York: 风速单位 mph', ny?.unitLabels?.windSpeed === 'mph')

  console.log('\n-- B5. 逐时数据 --')
  const hourly = await getForecast.execute({ location: '上海', days: 3, includeHourly: true }, exec)
  check('逐时: 返回 48 条', hourly?.hourly?.length === 48, String(hourly?.hourly?.length))
  check('逐时: 字段完整', isNumber(hourly?.hourly?.[0]?.temperature) && isNumber(hourly?.hourly?.[0]?.precipitationProbability) && isNumber(hourly?.hourly?.[0]?.uvIndex))

  console.log('\n-- B6. 默认定位（公网 IP） --')
  const auto = await getWeather.execute({}, exec)
  check('自动定位: ok', auto?.ok === true, JSON.stringify(auto?.message ?? ''))
  check('自动定位: resolvedBy=ip 或 geocoding', ['ip', 'geocoding'].includes(auto?.query?.resolvedBy), String(auto?.query?.resolvedBy))

  console.log('\n-- B7. 未来几天预报（默认与指定日期） --')
  const defaulted = await getWeather.execute({ location: '上海' }, exec)
  check('get_weather 默认给 3 天预报', defaulted?.daily?.length === 3, String(defaulted?.daily?.length))
  check('默认 3 天: 逐日含体感区间', isNumber(defaulted?.daily?.[2]?.apparentTemperatureMin) && isNumber(defaulted?.daily?.[2]?.apparentTemperatureMax))
  check('默认 3 天: 摘要含趋势行', String(defaulted?.summary ?? '').includes('趋势'), String(defaulted?.summary ?? '').slice(0, 80))

  const base = await getForecast.execute({ location: '上海', days: 5 }, exec)
  check('get_weather_forecast 默认参数可用', base?.daily?.length === 5, String(base?.daily?.length))
  const targetDay = base?.daily?.[1]?.date
  const oneDay = await getForecast.execute({ location: '上海', days: 5, date: targetDay }, exec)
  check('指定日期: 只回该日逐时 24 条', oneDay?.hourly?.length === 24, String(oneDay?.hourly?.length))
  check('指定日期: hourlyDate 正确', oneDay?.hourlyDate === targetDay, String(oneDay?.hourlyDate))
  check(
    '指定日期: 逐时都属于该日',
    (oneDay?.hourly ?? []).every((row) => String(row.time).startsWith(targetDay)),
  )
  check('指定日期: 摘要标注该日', String(oneDay?.summary ?? '').includes(`逐时 · ${targetDay}`), String(oneDay?.summary ?? '').slice(0, 120))

  console.log('\n-- B8. 语言（per-call 覆盖） --')
  const japanese = await getWeather.execute({ location: '上海', days: 1, language: 'ja' }, exec)
  check('per-call language=ja: ok', japanese?.ok === true, JSON.stringify(japanese?.message ?? ''))
  check('per-call language=ja: 摘要用日语标签', String(japanese?.summary ?? '').includes('気温'), String(japanese?.summary ?? '').slice(0, 60))
  check('per-call language=ja: query.language 回显', japanese?.query?.language === 'ja', String(japanese?.query?.language))
  check('per-call language=ja: 天气现象已本地化', japanese?.current?.weather !== oneDay?.current?.weather, String(japanese?.current?.weather))
  const german = await getForecast.execute({ location: '上海', days: 2, language: 'de' }, exec)
  check('per-call language=de: 摘要用德语标签', String(german?.summary ?? '').includes('Luftfeuchte'), String(german?.summary ?? '').slice(0, 60))
  check('per-call language=de: 逐日 2 天', german?.daily?.length === 2, String(german?.daily?.length))

  const far = new Date(`${base?.daily?.[0]?.date}T00:00:00Z`)
  far.setUTCDate(far.getUTCDate() + 9)
  const farDate = far.toISOString().slice(0, 10)
  const extended = await getForecast.execute({ location: '上海', days: 2, date: farDate }, exec)
  check('超出窗口: 自动扩展到 16 天', extended?.daily?.length === 16, String(extended?.daily?.length))
  check('超出窗口: 仍能取到该日逐时', extended?.hourly?.length === 24 && extended?.hourlyDate === farDate, `${extended?.hourly?.length} / ${extended?.hourlyDate}`)
  check('超出窗口: 有说明 note', (extended?.notes ?? []).some((note) => note.includes('扩展到 16 天')), JSON.stringify(extended?.notes ?? []))

  console.log('\n-- B8. 错误路径 --')
  const bogus = await getWeather.execute({ location: 'zzzzqqqxxyy' }, exec)
  check('找不到地点: ok=false', bogus?.ok === false)
  check('找不到地点: 给出可读提示', typeof bogus?.message === 'string' && bogus.message.includes('找不到'))
  const tooShort = await getWeather.execute({ location: 'a' }, exec)
  check('地点名过短: ok=false', tooShort?.ok === false)
  const rendered = getWeather.output.render({}, bogus)
  check('错误路径 render 不抛异常', Array.isArray(rendered) && rendered.length >= 1)
  const badDate = await getForecast.execute({ location: '上海', days: 3, date: '2030-01-01' }, exec)
  check('未来过远的日期: 不报错且有说明', badDate?.ok === true && (badDate?.notes ?? []).some((note) => note.includes('不在预报窗口')), JSON.stringify(badDate?.notes ?? []))
} catch (error) {
  failed += 1
  failures.push(`未捕获异常：${error?.stack ?? error}`)
  console.log(`  ❌ 未捕获异常：${error?.stack ?? error}`)
}
}

console.log(`\n=== 结果：${passed} 通过 / ${failed} 失败 ===`)
if (failures.length) {
  console.log('\n失败明细：')
  for (const item of failures) console.log(`  · ${item}`)
}
process.exit(failed ? 1 : 0)
