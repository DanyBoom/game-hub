param([string]$Port='auto', [string]$InstallRoot="$env:ProgramData\GameHubServer")
$ErrorActionPreference='Stop'
if ($Port -ne 'auto' -and ($Port -notmatch '^\d+$' -or [int]$Port -lt 1024 -or [int]$Port -gt 65535)) { throw 'Port must be auto or 1024..65535' }
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run PowerShell as Administrator' }
$source=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$install=[IO.Path]::GetFullPath($InstallRoot)
if ($install -eq $source -or $install.Contains('"') -or $install.Contains("`n")) { throw 'Choose a separate installation directory' }
$data=Join-Path $install 'data'
$app=Join-Path $install 'app'
$runtime=Join-Path $install 'node'
if (Get-ScheduledTask -TaskName 'GameHubServer' -ErrorAction SilentlyContinue) { throw 'GameHubServer already exists. Stop the task and use the documented update procedure.' }
New-Item -ItemType Directory -Force -Path $app,$data,$runtime | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $source 'package.json'))) {
  $base='https://github.com/DanyBoom/game-hub/releases/download/v0.4.0'
  $bundle=Join-Path $runtime 'GameHub-Server-0.4.0.zip'
  Invoke-WebRequest "$base/GameHub-Server-0.4.0.zip" -OutFile $bundle -UseBasicParsing
  $checks=(Invoke-WebRequest "$base/SHA256SUMS.txt" -UseBasicParsing).Content
  $checksum=($checks -split "`n" | Where-Object { $_ -match ' GameHub-Server-0.4.0.zip\s*$' } | Select-Object -First 1).Trim().Split(' ')[0]
  if ($checksum -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash -ne $checksum) { throw 'Server bundle SHA256 mismatch' }
  $source=Join-Path $runtime 'source'
  Expand-Archive -LiteralPath $bundle -DestinationPath $source -Force
}
$manifest=(Invoke-WebRequest 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt' -UseBasicParsing).Content
$entry=($manifest -split "`n" | Where-Object { $_ -match ' node-v24\.\d+\.\d+-win-x64\.zip\s*$' } | Select-Object -First 1).Trim() -split '\s+'
if ($entry.Length -ne 2) { throw 'Node distribution not found' }
$archive=Join-Path $runtime $entry[1]
Invoke-WebRequest "https://nodejs.org/dist/latest-v24.x/$($entry[1])" -OutFile $archive -UseBasicParsing
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $entry[0]) { throw 'Node SHA256 mismatch' }
Expand-Archive -LiteralPath $archive -DestinationPath $runtime -Force
$nodeDir=Join-Path $runtime ([IO.Path]::GetFileNameWithoutExtension($entry[1]))
$node=Join-Path $nodeDir 'node.exe'
$env:PATH="$nodeDir;$env:PATH"
foreach($name in @('package.json','package-lock.json','tsconfig.json','vite.config.ts','vite.server.config.ts','index.html','electron','shared','src','server','web','native','scripts')) { Copy-Item -LiteralPath (Join-Path $source $name) -Destination $app -Recurse -Force }
Push-Location $app
try {
  & $node (Join-Path $nodeDir 'node_modules\npm\bin\npm-cli.js') ci --ignore-scripts --no-audit --no-fund
  if($LASTEXITCODE){throw 'npm ci failed'}
  & $node (Join-Path $nodeDir 'node_modules\npm\bin\npm-cli.js') run build:server
  if($LASTEXITCODE){throw 'Build failed'}
  & $node 'dist-server\server.cjs' --data $data --port $Port --host 127.0.0.1 --init
  if($LASTEXITCODE){throw 'Initialization failed'}
} finally { Pop-Location }
$actualPort=(Get-Content -LiteralPath (Join-Path $data 'panel.json') -Raw | ConvertFrom-Json).port
# Files with credentials are readable only by Administrators, SYSTEM and the service account.
& icacls.exe $data '/inheritance:r' '/grant:r' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' '*S-1-5-19:(OI)(CI)M' '/T' | Out-Null
if($LASTEXITCODE){throw 'Could not restrict access to server data'}
& icacls.exe $app '/grant' '*S-1-5-19:(OI)(CI)RX' | Out-Null
if($LASTEXITCODE){throw 'Could not grant application read access'}
& icacls.exe $runtime '/grant' '*S-1-5-19:(OI)(CI)RX' | Out-Null
if($LASTEXITCODE){throw 'Could not grant runtime read access'}
$action=New-ScheduledTaskAction -Execute $node -Argument ('"{0}" --data "{1}" --port {2} --host 0.0.0.0' -f (Join-Path $app 'dist-server\server.cjs'),$data,$actualPort) -WorkingDirectory $app
$principal=New-ScheduledTaskPrincipal -UserId 'S-1-5-19' -LogonType ServiceAccount
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'GameHubServer' -Action $action -Trigger (New-ScheduledTaskTrigger -AtStartup) -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName 'GameHubServer'
Write-Host "GameHub: https://<server-address>:$actualPort"
Write-Host 'Open this TCP port in the server firewall. The installer did not change firewall rules.'
