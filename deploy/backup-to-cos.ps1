param(
  [string]$ProjectDir = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
Set-Location $ProjectDir

if (-not $env:COS_BUCKET -or -not $env:COS_REGION) {
  throw "COS_BUCKET and COS_REGION are required"
}

$result = pnpm db:backup | ConvertFrom-Json
$file = Resolve-Path $result.output
coscli cp $file "cos://$($env:COS_BUCKET)/daily/$([IO.Path]::GetFileName($file))" --region $env:COS_REGION

if ($LASTEXITCODE -ne 0) {
  throw "Encrypted backup upload failed"
}
