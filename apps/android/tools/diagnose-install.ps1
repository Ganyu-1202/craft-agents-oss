param(
    [string]$ApkPath = "",
    [string]$Serial = "",
    [switch]$TryInstall
)

# Default mode reads local APK/device information only. Installation is an
# explicit opt-in; never uninstall apps, clear logs, or change MIUI settings.
$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
if (-not $ApkPath) { $ApkPath = Join-Path $projectRoot "dist/android/tokenbird-release.apk" }
$apkFile = (Resolve-Path -LiteralPath $ApkPath).Path
$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) {
    $env:ANDROID_SDK_ROOT
} else { Join-Path $env:LOCALAPPDATA "Android/Sdk" }
$tools = Get-ChildItem -LiteralPath (Join-Path $sdkRoot "build-tools") -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName "apksigner.bat") } |
    Sort-Object { [version]($_.Name -replace '-.*$', '') } -Descending | Select-Object -First 1
if (-not $tools) { throw "Android SDK build-tools are required. Set ANDROID_HOME." }
$adb = Join-Path $sdkRoot "platform-tools/adb.exe"
if (-not (Test-Path -LiteralPath $adb)) { throw "Android SDK platform-tools are required." }
$reportRoot = Join-Path $projectRoot (".build/android-install-diagnostics/" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $reportRoot | Out-Null

function Invoke-DiagnosticTool {
    param([string]$Executable, [string[]]$Arguments, [string]$LogName)
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = & $Executable @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    $outputText = ($output | ForEach-Object { $_.ToString() }) -join "`n"
    if ($LogName) { $outputText | Set-Content -LiteralPath (Join-Path $reportRoot $LogName) -Encoding utf8 }
    return [PSCustomObject]@{ ExitCode = $exitCode; Output = $outputText }
}

function Get-BadgingValue {
    param([string]$Text, [string]$Pattern)
    $match = [regex]::Match($Text, $Pattern, [Text.RegularExpressions.RegexOptions]::Multiline)
    if ($match.Success) { return $match.Groups[1].Value }
    return $null
}

$previousJavaHome = $env:JAVA_HOME
$bundledJdk = Join-Path $projectRoot ".toolchains/android/jdk17"
try {
    if (Test-Path (Join-Path $bundledJdk "bin/java.exe")) { $env:JAVA_HOME = $bundledJdk }
    $badging = Invoke-DiagnosticTool (Join-Path $tools.FullName "aapt.exe") @("dump", "badging", $apkFile) "apk-badging.txt"
    $signature = Invoke-DiagnosticTool (Join-Path $tools.FullName "apksigner.bat") @("verify", "--verbose", "--print-certs", $apkFile) "apk-signature.txt"
    $alignment = Invoke-DiagnosticTool (Join-Path $tools.FullName "zipalign.exe") @("-c", "-P", "16", "4", $apkFile) "apk-alignment.txt"
    $packageName = Get-BadgingValue $badging.Output "^package: name='([^']+)'"
    $summary = [ordered]@{
        ApkPath = $apkFile
        Sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $apkFile).Hash.ToLowerInvariant()
        PackageName = $packageName
        VersionCode = Get-BadgingValue $badging.Output "^package:.*versionCode='([^']+)'"
        MinSdk = Get-BadgingValue $badging.Output "^sdkVersion:'([^']+)'"
        TargetSdk = Get-BadgingValue $badging.Output "^targetSdkVersion:'([^']+)'"
        NativeAbis = Get-BadgingValue $badging.Output "^native-code: (.+)$"
        ApkParses = ($badging.ExitCode -eq 0 -and [bool]$packageName)
        SignatureValid = ($signature.ExitCode -eq 0)
        AlignmentValid = ($alignment.ExitCode -eq 0)
        Device = $null
        Findings = @()
        InstallAttempted = $false
        InstallResult = $null
    }
    if (-not $summary.ApkParses) { $summary.Findings += "APK_PARSE_FAILED_ON_HOST" }
    if (-not $summary.SignatureValid) { $summary.Findings += "APK_SIGNATURE_INVALID" }
    if (-not $summary.AlignmentValid) { $summary.Findings += "APK_ALIGNMENT_INVALID" }

    $devices = Invoke-DiagnosticTool $adb @("devices", "-l") "adb-devices.txt"
    if ($devices.ExitCode -ne 0) { throw "Cannot query ADB devices. See adb-devices.txt." }
    $authorized = @([regex]::Matches($devices.Output, "(?m)^([^\s]+)\s+device(?:\s|$)") |
        ForEach-Object { $_.Groups[1].Value })
    if ($Serial -and $authorized -notcontains $Serial) { throw "Requested device is not connected and authorized: $Serial" }
    if (-not $Serial -and $authorized.Count -gt 1) { throw "Multiple devices connected. Select one with -Serial." }
    if (-not $Serial -and $authorized.Count -eq 1) { $Serial = $authorized[0] }
    if ($Serial) {
        $deviceInfo = [ordered]@{ Serial = $Serial }
        foreach ($property in @("ro.product.manufacturer", "ro.product.model", "ro.build.version.release",
            "ro.build.version.sdk", "ro.product.cpu.abilist", "ro.product.cpu.abilist64",
            "ro.miui.ui.version.name", "ro.mi.os.version.name", "persist.sys.miui_optimization")) {
            $value = Invoke-DiagnosticTool $adb @("-s", $Serial, "shell", "getprop", $property) ""
            $deviceInfo[$property] = if ($value.ExitCode -eq 0) { $value.Output.Trim() } else { $null }
        }
        $summary.Device = $deviceInfo
        # An absent MIUI property is not proof that optimization is enabled or
        # disabled; HyperOS/MIUI versions expose different properties.
        $deviceSdk = 0
        if ($summary.MinSdk -and [int]::TryParse($deviceInfo["ro.build.version.sdk"], [ref]$deviceSdk) -and
            $deviceSdk -lt [int]$summary.MinSdk) { $summary.Findings += "ANDROID_VERSION_TOO_OLD" }
        $deviceAbis = @($deviceInfo["ro.product.cpu.abilist"] -split ",")
        $apkAbis = @([regex]::Matches([string]$summary.NativeAbis, "'([^']+)'") |
            ForEach-Object { $_.Groups[1].Value })
        if ($apkAbis.Count -gt 0 -and $deviceInfo["ro.product.cpu.abilist"] -and
            @($apkAbis | Where-Object { $deviceAbis -contains $_ }).Count -eq 0) {
            $summary.Findings += "CPU_ABI_NOT_SUPPORTED"
        }
        if ($packageName) {
            $installed = Invoke-DiagnosticTool $adb @("-s", $Serial, "shell", "dumpsys", "package", $packageName) "installed-package.txt"
        }
        if ($TryInstall) {
            if ($summary.Findings.Count -gt 0) { throw "APK/device compatibility checks failed; installation was not attempted." }
            $summary.InstallAttempted = $true
            $install = Invoke-DiagnosticTool $adb @("-s", $Serial, "install", "-r", $apkFile) "adb-install.txt"
            $failure = [regex]::Match($install.Output, "Failure\s*\[([^\]]+)\]")
            if ($install.ExitCode -eq 0 -and $install.Output -match "(?m)^Success\s*$") {
                $summary.InstallResult = "SUCCESS"
            } elseif ($failure.Success) {
                $summary.InstallResult = $failure.Groups[1].Value
            } else { $summary.InstallResult = "ADB_INSTALL_FAILED: " + $install.Output.Trim() }
        }
        $logs = Invoke-DiagnosticTool $adb @("-s", $Serial, "logcat", "-d", "-v", "threadtime", "-t", "2000") ""
        if ($logs.ExitCode -eq 0) {
            $logs.Output -split "`n" | Where-Object {
                $_ -match "PackageManager|PackageInstaller|PackageParser|ApkSignatureVerifier|installd|packageInfo|INSTALL_FAILED|INSTALL_PARSE_FAILED"
            } | Set-Content -LiteralPath (Join-Path $reportRoot "package-install-logcat.txt") -Encoding utf8
        }
    } else {
        $summary.Findings += "NO_AUTHORIZED_DEVICE"
        if ($TryInstall) { throw "No authorized device connected. Enable USB debugging and authorize this computer." }
    }
} finally {
    if ($summary) { $summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $reportRoot "summary.json") -Encoding utf8 }
    $env:JAVA_HOME = $previousJavaHome
    Write-Output "Diagnostic report: $reportRoot"
}
if (-not $summary.ApkParses -or -not $summary.SignatureValid -or -not $summary.AlignmentValid -or
    ($TryInstall -and $summary.InstallResult -ne "SUCCESS")) { exit 1 }
$summary | ConvertTo-Json -Depth 5 | Write-Output
