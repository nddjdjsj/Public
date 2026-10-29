param([string]$SillyTavernRoot = 'D:\SillyTavern-1.19.0')
$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$hostPath = (Resolve-Path -LiteralPath $SillyTavernRoot).Path.TrimEnd('\', '/')
$hostPackage = Get-Content -Raw -LiteralPath (Join-Path $hostPath 'package.json') | ConvertFrom-Json
$package = Get-Content -Raw -LiteralPath (Join-Path $projectPath 'package.json') | ConvertFrom-Json
if ([version]$hostPackage.version -lt [version]'1.19.0') { throw 'SillyTavern 1.19.0 or later is required.' }
$targetPath = [IO.Path]::GetFullPath((Join-Path $hostPath 'public/scripts/extensions/third-party/SillyTavern-PsycheEngine'))
if (-not $targetPath.StartsWith($hostPath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Target must remain inside the selected SillyTavern directory.' }
$files = @(
    foreach ($line in Get-Content -LiteralPath (Join-Path $projectPath 'SHA256SUMS.txt')) {
        if ($line -notmatch '^([a-f0-9]{64})  (.+)$') { throw 'Invalid file inventory' }
        $relativePath = $Matches[2]
        if ($relativePath.Contains('..') -or [IO.Path]::IsPathRooted($relativePath)) { throw 'Unsafe inventory path' }
        $sourcePath = Join-Path $projectPath $relativePath
        if ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Matches[1]) { throw "Source changed; run package.ps1 again: $relativePath" }
        $relativePath
    }
    'SHA256SUMS.txt'
)
if (Test-Path -LiteralPath $targetPath) {
    $backupRoot = Join-Path (Split-Path -Parent $projectPath) 'install-backups'
    $backupPath = Join-Path $backupRoot ('PsycheEngine-' + (Get-Date -Format 'yyyyMMdd-HHmmss-ffff'))
    New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
    Copy-Item -LiteralPath $targetPath -Destination $backupPath -Recurse
    Write-Output "Prior extension backed up to $backupPath"
}
New-Item -ItemType Directory -Force -Path $targetPath | Out-Null
foreach ($relativePath in $files) {
    $destinationPath = Join-Path $targetPath $relativePath
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destinationPath) | Out-Null
    Copy-Item -LiteralPath (Join-Path $projectPath $relativePath) -Destination $destinationPath -Force
    if ((Get-FileHash -LiteralPath $destinationPath -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath (Join-Path $projectPath $relativePath) -Algorithm SHA256).Hash) { throw "Installed copy mismatch: $relativePath" }
}
Write-Output "Installed PsycheEngine $($package.version) for SillyTavern $($hostPackage.version): $targetPath"
Write-Output "Verified $($files.Count) files. Restart or refresh SillyTavern and enable Function Calling in the active Chat Completion connection."
