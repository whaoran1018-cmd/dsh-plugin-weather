/**
 * dsh-plugin-weather — host half.
 *
 * Registers two agent-callable tools backed by Open-Meteo (no API key):
 *   · get_weather          当前天气 + 空气质量 + 默认 3 天逐日
 *   · get_weather_forecast 1–16 天预报（可指定某天逐时）
 *
 * 备注：这个文件也是 HMR 的「入口」。改完 lib 下任何模块后，顺手在这里
 * 动一下（例如下面的 revision 注释）能让宿主重新装载整条依赖图。
 * revision: 2
 */
import { Config as WeatherConfig, resolveConfig } from './config.js'
import { registerWeatherTools } from './tools.js'

export const name = 'dsh-plugin-weather'
export const inject = ['tools']
export const Config = WeatherConfig

export function apply(ctx, config) {
  registerWeatherTools(ctx, resolveConfig(config))
}

export default { name, inject, Config, apply }
