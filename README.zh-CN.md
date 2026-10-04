# dsh-plugin-weather · 全球天气与环境插件

> English version: [README.md](README.md)

给 DeepSeek Harness 加一个「随时能问天气」的能力：**任何地点、当前实况 + 未来 1–16 天预报 + 空气质量**，
数据全部来自免费、无需 API Key 的公开接口（Open-Meteo / CAMS）。

- 温度、体感温度、湿度、露点
- **紫外线指数**与等级（低 / 中等 / 高 / 很高 / 极高）
- **风向（16 方位 + 度数）+ 风速 + 阵风**
- **日出 / 日落 / 白昼时长**（按当地时区）
- 降水、云量、气压、天气现象
- **空气质量**：PM2.5、PM10、O₃、NO₂、SO₂、CO、US AQI、欧洲 AQI（含分级）

## 两个工具

| 工具 | 用途 | 主要参数 |
| --- | --- | --- |
| `get_weather` | 实时实况 + 空气质量，**默认再给今天 + 未来两天**的逐日 | `location`（城市名或 `"纬度,经度"`）、`latitude`/`longitude`、`units`、`days`(0–16，默认 3)、`includeAirQuality` |
| `get_weather_forecast` | 1–16 天逐日预报；可要逐时（从此刻起 48 小时），也可只要某一天的 24 小时 | 同上 + `days`(1–16，默认 5)、`includeHourly`、`date`(YYYY-MM-DD) |

逐日每行都带：日期/星期、天气现象、最低~最高气温、体感温度区间、降水概率与雨量、紫外线最大值与等级、
主导风向风速、日出日落；多天时摘要里还会多一行**趋势**（温度区间 / 最湿的一天 / 紫外线峰值）。
`date` 落在默认窗口之外时会自动把预报范围扩到 16 天（结果里会写明）。

地点解析顺序：显式 `latitude`+`longitude` → `location`（城市名走 Open-Meteo Geocoding，支持中文；
`"31.23,121.47"` 走坐标）→ 插件配置的 `defaultLocation` → 公网 IP 定位（ipwho.is → freeipapi.com → ip-api.com）。

数据源顺序：Open-Meteo（主）→ wttr.in（仅在 Open-Meteo 天气接口失败时回退，字段较少且无空气质量）。
空气质量始终来自 Open-Meteo Air Quality（CAMS）。

## 安装（别人怎么装）

### 1. 走 DSH 插件管理器（推荐）

仓库公开后，直接让 agent 装（或插件页操作）：

```
plugin_manager { "action": "install_bundle", "target": "github:whaoran1018-cmd/dsh-plugin-weather" }
```

插件管理器会把包装进 profile、写进 `dsh.profile.bundles` 并激活。工具没立刻出现就重载/重启一次 DSH。

### 2. 手工加进已有 profile

```powershell
cd ~/.dsh/profiles/<profile>
pnpm add link:C:/path/to/dsh-plugin-weather      # 也可以 file: 或已发布的版本号
```

然后把 `"dsh-plugin-weather"` 加进该 profile `package.json` 的 `dsh.profile.bundles`。
包自带 `cordis.patch.yml`，Loader 会自动插入插件行。

### 3. 直接拷进去（不用包管理器）

把目录拷到 `~/.dsh/profiles/<profile>/plugins/dsh-plugin-weather`，在 profile 的 `cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: weather
      name: 'dsh-plugin-weather'
```

目录别放点号目录（DSH 的 watcher 默认忽略 `**/.*`）。

## 仓库结构

```
<repo>/                              # 仓库根目录（本机放在 D:\linelink\dsh-plugin-weather）
├── package.json                    # dsh.bundle.patch → cordis.patch.yml
├── cordis.patch.yml                # 插入一行：id=weather, name=dsh-plugin-weather（用包名，可移植）
├── lib/                            # 宿主半边：index.js / tools.js / service.js / openmeteo.js / wttr.js / geo.js / http.js / codes.js / format.js / config.js
├── test/selftest.mjs               # 离线契约 + 联网真数据自测（199 项）
├── tools/
│   ├── verify.ps1                  # 校验装载状态 / 依赖链接 / 重新链接
│   └── verify-schema-subset.mjs    # 用 app.asar 里 DSH 真实校验器复核工具 schema
├── .github/workflows/ci.yml        # CI：离线自测（Node 20/22）+ 定时跑联网自测
└── CHANGELOG.md / LICENSE / .gitignore / .gitattributes
```

本机把源码放在工作区，DSH profile 通过 `link:` 指向它——一份真源，既能跑也能推：

1. `profiles/desktop/package.json`
   - `dependencies["dsh-plugin-weather"] = "link:<repo 路径>"`
   - `dsh.profile.bundles` 里包含 `"dsh-plugin-weather"`
2. `node_modules/dsh-plugin-weather` 是指向仓库目录的 junction（pnpm 生成）
3. 该包的 `cordis.patch.yml` 被当作 bundle patch 应用，插入 `id: weather` 的插件行


改代码时的三条实测结论（都验证过）：

- **本机 desktop profile 里宿主插件 HMR 实际不触发**：改 `lib/` 下任何文件（含入口 `index.js`）后，运行中的宿主仍跑旧代码。
  新代码要生效：**重载/重启一次 DSH**。
  已用两条独立证据确认：改完文件后入口仍返回旧默认值；把 patch 的 `name` 换成新 URL 后立刻生效（说明是模块缓存，不是代码问题）。
- **源码不要放点号目录**：DSH 的 HMR 监视器默认 `ignored: ["**/node_modules", "**/.*", "cache", "data"]`，
  点号目录里的文件根本不会被 watch。
  `name` 里带 `?v=2` 这种 query 也不行——加载器会把它转义成 `%3Fv=2` 当文件名（实测 `failed to import`）。
- **别声明 `@deepseek-ai/dsh-*` 的 peerDependencies**（除非钉死到运行版本）：DSH 的兼容性闸门会拿这些 peer 跟
  运行版本比，不满足就**拒绝安装**（`dsh-builtin-browser` 就是这么被拦下的）。本包只依赖
  `@deepseek-ai/schemastery`（闸门不看它），其余靠注入的 `tools` 服务。

## 配置

在插件设置界面，或在 `profiles/desktop/cordis.patch.yml` 里给该行加 `config`：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `defaultLocation` | `""` | 未指定地点时用；空 = 公网 IP 定位 |
| `language` | `zh` | 摘要语言（zh / en） |
| `units` | `metric` | `metric`=°C/km/h/mm，`imperial`=°F/mph/inch |
| `includeAirQuality` | `true` | 是否附带空气质量 |
| `cacheTtlSeconds` | `300` | 相同请求的本地缓存秒数，0 = 关闭 |
| `requestTimeoutMs` | `15000` | 单次上游超时 |
| `provider` | `auto` | `auto`=失败回退 wttr.in；`open-meteo`=只用 Open-Meteo |

## 用法示例

直接问就行：

- 「上海现在天气怎么样」「雅加达空气质量」「明天几点日出」
- 「上海未来 7 天」「纽约这周会下雨吗」「哪天适合跑长跑」
- 「周三几点下雨」（= 指定 `date`，拿那一天的逐时）
- 「31.23,121.47 的紫外线」「纽约未来 5 天，要逐时」

工具返回两段：**人类可读摘要**（中文、带 emoji 与分级）+ **完整 JSON**（精确数值，便于再做判断）。

## 自测与验证

```powershell
cd D:\linelink\dsh-plugin-weather        # 或任何 clone 下来的位置
npm install                              # 唯一依赖：@deepseek-ai/schemastery
node test/selftest.mjs --offline         # 离线契约自测（不联网，CI 用这条）
node test/selftest.mjs                   # 再加联网真数据（199 项）
node tools/verify-schema-subset.mjs      # 用 app.asar 里 DSH 真实校验器复核工具 schema
powershell -File tools/verify.ps1 -ProfileDir $env:DSH_PROFILE_DIR   # 装载状态 + 依赖链接
```

`selftest.mjs` 内置了 DSH 工具 schema 子集的复刻校验；`verify-schema-subset.mjs` 更进一步，直接从
安装目录的 `app.asar` 里解出 `@deepseek-ai/dsh-tools` 的 json-schema 区域，用**宿主真正会跑的校验器**
复核本插件的 `parameters` 与 `output.schema`。

验证记录（2026-10-04 ~ 10-05，本机）：

| 项目 | 结果 |
| --- | --- |
| `node test/selftest.mjs` | 199 通过 / 0 失败（含默认 3 天、指定日逐时、越窗自动扩到 16 天等新用例） |
| `node tools/verify-schema-subset.mjs` | 4/4 通过真实校验器 |
| 宿主内实测 `get_weather`（上海 / 雅加达） | 成功，字段齐全（含紫外线 0（低）、日出日落、US AQI 72 / 183） |
| 宿主内实测 `get_weather_forecast`（雅加达 6 天 / 上海 7 天） | 成功，逐日 + 空气质量 |

## 已知边界

- 上游是公开免费接口，偶发超时/限流；插件已做 1 次重试 + 短缓存 + 多源回退，失败时返回可读错误而不是抛栈。
- IP 定位只到城市级，且可能被代理/VPN 影响（本机实测公网出口在东京）；需要准确结果请显式给地点。
- wttr.in 回退数据没有空气质量，且体感/风的最大值等字段可能缺失（结果里会标注）。
- 预报窗口最多 16 天；逐时最多到第 16 天，一次最多回 48 小时（`date` 指定那天则回 24 小时）。
- **改完 `lib/` 的代码要重载/重启 DSH 才生效**（本 profile 实测宿主插件 HMR 不触发），详见上面「改代码时的三条实测结论」。

## 卸载

```powershell
# 方式一：插件管理器
#   plugin_manager { action: "remove_bundle", target: "dsh-plugin-weather" }
# 方式二：手工
#   profiles/desktop/package.json 里删掉 dependencies 与 bundles 中的 dsh-plugin-weather
#   然后 pnpm install；源码目录可一并删除
```

## 数据来源与许可

- 天气/预报/地理编码：[Open-Meteo](https://open-meteo.com/)（CC BY 4.0，非商业免费）
- 空气质量：[Open-Meteo Air Quality](https://open-meteo.com/en/docs/air-quality-api)（CAMS）
- 回退源：[wttr.in](https://wttr.in/)
- IP 定位：ipwho.is / freeipapi.com / ip-api.com

本插件代码：MIT。
