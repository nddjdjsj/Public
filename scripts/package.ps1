param([string]$OutputPath = (Join-Path $PSScriptRoot '../../PsycheEngine-1.0.0.zip'))
$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$targetPath = [System.IO.Path]::GetFullPath($OutputPath)
$workspacePath = [System.IO.Path]::GetFullPath((Join-Path $projectPath '..'))
if (-not $targetPath.StartsWith($workspacePath + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'OutputPath must remain inside this project workspace.'
}
Push-Location -LiteralPath $projectPath
try {
    node scripts/check.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Project validation failed' }
    node scripts/inventory.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Inventory failed' }
} finally { Pop-Location }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$packageFiles = @(
    foreach ($line in Get-Content -LiteralPath (Join-Path $projectPath 'SHA256SUMS.txt')) {
        if ($line -notmatch '^[a-f0-9]{64}  (.+)$') { throw 'Invalid package inventory' }
        $relativePath = $Matches[1]
        if ($relativePath.Contains('..') -or [System.IO.Path]::IsPathRooted($relativePath)) { throw 'Unsafe package inventory path' }
        $relativePath
    }
    'SHA256SUMS.txt'
)
# Use the checked inventory instead of recursively archiving a Git checkout.
# This keeps .git, local credentials and dependency folders out of the artifact.
$stream = [System.IO.File]::Open($targetPath, [System.IO.FileMode]::Create)
$zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $prefix = [System.IO.Path]::GetFileName($projectPath) + '/'
    foreach ($relativePath in $packageFiles) {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $projectPath $relativePath), ($prefix + $relativePath.Replace('\', '/')), [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $zip.Dispose(); $stream.Dispose() }
$archive = [System.IO.Compression.ZipFile]::OpenRead($targetPath)
try {
    $checked = 0
    $prefix = [System.IO.Path]::GetFileName($projectPath) + '/'
    foreach ($entry in $archive.Entries) {
        if ($entry.FullName.EndsWith('/')) { continue }
        $entryPath = $entry.FullName.Replace('\', '/')
        if (-not $entryPath.StartsWith($prefix)) { throw "Unexpected ZIP root: $entryPath" }
        $relativePath = $entryPath.Substring($prefix.Length)
        if ($relativePath.Contains('..')) { throw 'Unsafe ZIP path' }
        $sourcePath = Join-Path $projectPath $relativePath
        $stream = $entry.Open()
        try { $actual = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($stream)) }
        finally { $stream.Dispose() }
        $expected = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
        if ($actual -ne $expected) { throw "Archive mismatch: $relativePath" }
        $checked++
    }
    $fileCount = $packageFiles.Count
    if ($checked -ne $fileCount) { throw "File count mismatch: $checked versus $fileCount" }
    Write-Output "ZIP integrity verified: $checked files"
} finally { $archive.Dispose() }
$zipHash = (Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath ($targetPath + '.sha256') -Value ($zipHash + '  ' + [System.IO.Path]::GetFileName($targetPath)) -Encoding utf8
Get-Item -LiteralPath $targetPath | Select-Object FullName,Length
Write-Output "SHA256: $zipHash"
