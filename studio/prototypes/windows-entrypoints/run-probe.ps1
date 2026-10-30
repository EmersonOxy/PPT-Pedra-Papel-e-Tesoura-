$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
  throw "Compilador .NET Framework não encontrado: $compiler"
}

$sourceRoot = $PSScriptRoot
$outputRoot = Join-Path $env:TEMP 'TrindadeStudio-Marco1-EntrypointProbe'
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
$launcherSource = Join-Path $sourceRoot 'Launcher.cs'
$hostSource = Join-Path $sourceRoot 'StudioHostProbe.cs'
$hostExe = Join-Path $outputRoot 'Trindade-Studio.exe'
$testExe = Join-Path $outputRoot 'Testar-Jogo.exe'
$gitExe = Join-Path $outputRoot 'Enviar-Git.exe'

& $compiler /nologo /target:exe "/out:$hostExe" $hostSource
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o host de teste.' }
& $compiler /nologo /target:exe "/out:$testExe" $launcherSource
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar Testar-Jogo.exe.' }
& $compiler /nologo /target:exe "/out:$gitExe" $launcherSource
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar Enviar-Git.exe.' }

$testOutput = & $testExe 2>&1 | Out-String
$testExit = $LASTEXITCODE
$gitOutput = & $gitExe 2>&1 | Out-String
$gitExit = $LASTEXITCODE

if ($testExit -ne 23 -or $testOutput -notmatch '--mode=test') {
  throw "Roteamento de Testar-Jogo falhou (exit=$testExit): $testOutput"
}
if ($gitExit -ne 29 -or $gitOutput -notmatch '--mode=git') {
  throw "Roteamento de Enviar-Git falhou (exit=$gitExit): $gitOutput"
}

Write-Output 'Launcher probe: aprovado'
Write-Output "Testar-Jogo.exe -> Trindade-Studio.exe --mode=test (exit code propagado: $testExit)"
Write-Output "Enviar-Git.exe -> Trindade-Studio.exe --mode=git (exit code propagado: $gitExit)"
Write-Output "Artefatos descartáveis: $outputRoot"
