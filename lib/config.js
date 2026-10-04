/**
 * Plugin config (schemastery). Defaults apply when a key is absent, so the
 * plugin works with an empty config and stays editable from the insert row.
 */
import SchemaModule from '@deepseek-ai/schemastery'
import { DEFAULT_LANGUAGE, LANGUAGES, resolveLanguage } from './i18n.js'

const Schema = SchemaModule?.default ?? SchemaModule

export const Config = Schema.object({
  defaultLocation: Schema.string()
    .default('')
    .description('未指定地点时使用的默认地点：城市名（中/英文）或 "纬度,经度"。留空 = 用公网 IP 自动定位。'),
  language: Schema.union(LANGUAGES)
    .default(DEFAULT_LANGUAGE)
    .description(`Summary language: ${LANGUAGES.join(' / ')}（摘要语言，支持 9 种）。`),
  units: Schema.union(['metric', 'imperial'])
    .default('metric')
    .description('单位制：metric（°C / km/h / mm）或 imperial（°F / mph / inch）。'),
  includeAirQuality: Schema.boolean()
    .default(true)
    .description('是否一并返回空气质量（PM2.5 / PM10 / O₃ / NO₂ / SO₂ / CO 与 US AQI、欧洲 AQI）。'),
  cacheTtlSeconds: Schema.number()
    .min(0)
    .default(300)
    .description('相同请求的本地缓存秒数；0 = 不缓存。'),
  requestTimeoutMs: Schema.number()
    .min(1000)
    .default(15000)
    .description('单次上游请求的超时（毫秒）。'),
  provider: Schema.union(['auto', 'open-meteo'])
    .default('auto')
    .description('数据源：auto = Open-Meteo 天气接口失败时回退 wttr.in；open-meteo = 只用 Open-Meteo。'),
})

/** Normalize whatever the Loader hands us into the exact shape the code uses. */
export function resolveConfig(input) {
  const cfg = input && typeof input === 'object' ? input : {}
  const ttl = Number(cfg.cacheTtlSeconds)
  const timeout = Number(cfg.requestTimeoutMs)
  return {
    defaultLocation: typeof cfg.defaultLocation === 'string' ? cfg.defaultLocation.trim() : '',
    language: resolveLanguage(cfg.language ?? DEFAULT_LANGUAGE),
    units: cfg.units === 'imperial' ? 'imperial' : 'metric',
    includeAirQuality: cfg.includeAirQuality !== false,
    cacheTtlSeconds: Number.isFinite(ttl) && ttl >= 0 ? ttl : 300,
    requestTimeoutMs: Number.isFinite(timeout) && timeout >= 1000 ? timeout : 15000,
    provider: cfg.provider === 'open-meteo' ? 'open-meteo' : 'auto',
  }
}
