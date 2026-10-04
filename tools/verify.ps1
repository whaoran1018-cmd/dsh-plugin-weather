# dsh-plugin-weather — local install / verification helper.
#
#   powershell -File tools/verify.ps1                      # verify + run tests
#   powershell -File tools/verify.ps1 -Relink              # also re-run pnpm install
#   powershell -File tools/verify.ps1 -ProfileDir <dir>    # check a specific DSH profile
param(
  [string]$ProfileDir = $env:DSH_PROFILE_DIR,
  [switch]$Relink
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$linkName = 'dsh-plugin-weather'

function Line($ok, $text) {
  if ($ok) { Write-Host "  [OK]   $text" -ForegroundColor Green }
  else { Write-Host "  [FAIL] $text" -ForegroundColor Red }
}

Write-Host "`n=== 1. 仓库文件 ==="
foreach ($f in 'package.json', 'cordis.patch.yml', 'README.md', 'LICENSE', 'lib\index.js', 'lib\tools.js', 'test\selftest.mjs') {
  Line (Test-Path (Join-Path $repo $f)) $f
}

if (-not $ProfileDir) {
  Write-Host "`n=== 2. profile 装载检查 === 已跳过（未提供 -ProfileDir，且环境变量 DSH_PROFILE_DIR 为空）"
} else {
  Write-Host "`n=== 2. profile 装载检查（$ProfileDir） ==="
  $manifestPath = Join-Path $ProfileDir 'package.json'
  if (-not (Test-Path $manifestPath)) {
    Line $false "找不到 $manifestPath"
  } else {
    $manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $dep = $manifest.dependencies.$linkName
    Line ($null -ne $dep) "dependencies['$linkName'] = $dep"
    Line ($manifest.dsh.profile.bundles -contains $linkName) "dsh.profile.bundles 含 $linkName"
    $linkPath = Join-Path $ProfileDir "node_modules\$linkName"
    if (Test-Path $linkPath) {
      $item = Get-Item $linkPath -Force
      Line ($null -ne $item.Target) "node_modules 链接 → $($item.Target)"
      Line (Test-Path (Join-Path $linkPath 'lib\index.js')) '链接可解析到 lib/index.js'
    } else {
      Line $false "缺少 $linkPath（用 -Relink 修复）"
    }
  }
}

if ($Relink -and $ProfileDir) {
  Write-Host "`n=== 3. pnpm install（重新链接） ==="
  Push-Location $ProfileDir
  $env:CI = 'true'
  pnpm install --no-frozen-lockfile
  Pop-Location
  Write-Host '  完成。宿主仍在运行时需重载/重启 DSH 才会用上新代码。'
}

Write-Host "`n=== 4. 离线契约自测 ==="
Push-Location $repo
node test/selftest.mjs --offline
$unitExit = $LASTEXITCODE
Pop-Location

Write-Host "`n=== 5. DSH 真实 schema 校验（找不到 app.asar 会自动跳过） ==="
Push-Location $repo
node tools/verify-schema-subset.mjs
Pop-Location

if ($unitExit -ne 0) { Write-Host "`n离线自测失败。" -ForegroundColor Red; exit $unitExit }
Write-Host "`n完成。"
