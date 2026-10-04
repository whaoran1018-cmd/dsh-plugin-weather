# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-10-05

### Added
- `get_weather` now returns a **3-day outlook by default** (today + next two days); pass `days: 0` for current conditions only.
- `get_weather_forecast` accepts `date: "YYYY-MM-DD"` and returns that day's 24 hourly rows.
- Forecast window auto-widens to 16 days when the requested `date` falls outside the default window.
- Summary gains a **trend line** for multi-day results: temperature range, wettest day, UV peak.

### Changed
- `days` default for `get_weather`: 1 → 3.
- Tool descriptions now mention the forecast defaults in both Chinese and English.

## [0.1.0] - 2026-10-04

### Added
- Initial release: `get_weather` (current conditions + air quality) and `get_weather_forecast` (1–16 day daily forecast, optional hourly).
- Temperature, feels-like, humidity, dew point, precipitation, cloud cover, pressure, UV index + level,
  16-point wind direction + speed + gusts, sunrise/sunset/daylight, PM2.5/PM10/O₃/NO₂/SO₂/CO, US AQI and European AQI.
- Location resolution: explicit coordinates → city name (Open-Meteo geocoding, Chinese supported) → configured
  default → public-IP fallback (ipwho.is → freeipapi.com → ip-api.com).
- Providers: Open-Meteo (primary), wttr.in (fallback for weather), Open-Meteo Air Quality (CAMS).
- Config via schemastery: `defaultLocation`, `language`, `units`, `includeAirQuality`, `cacheTtlSeconds`,
  `requestTimeoutMs`, `provider`.
- Tests: 187-check offline contract + live self-test, plus a schema-subset verifier that runs DSH's real validator.
