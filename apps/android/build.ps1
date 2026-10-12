param(
    [string]$ServerUrl = "wss://agent.goldgom.top:50003",
    [string]$DebugApplicationIdSuffix = "",
    [switch]$Release,
    [ValidateSet("Apk", "Aab", "Both")]
    [string]$Artifact = "Apk",
    [string]$SigningProperties = "",
    [string]$VersionCode = "",
    [string]$VersionName = "",
    [switch]$ValidateOnly,
    [switch]$SkipToolchainInstall,
    [switch]$SkipServerRuntimeDownload
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$androidRoot = $PSScriptRoot
$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA "Android\Sdk" }
$bunAndroidVersion = "1.3.14"

# Hash through .NET so minimal PowerShell hosts do not need Get-FileHash.
function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        return -join ($hasher.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") })
    } finally {
        $hasher.Dispose()
        $stream.Dispose()
    }
}

if (($Artifact -ne "Apk" -or $SigningProperties -or $ValidateOnly) -and -not $Release) {
    throw "-Artifact Aab/Both, -SigningProperties and -ValidateOnly require -Release."
}
if ($Release -and $DebugApplicationIdSuffix) { throw "-DebugApplicationIdSuffix only applies to debug builds." }
$releaseArgs = @()
if ($SigningProperties) {
    $signingFile = (Resolve-Path -LiteralPath $SigningProperties).Path
    $releaseArgs += "-PsigningProperties=$signingFile"
}
if ($VersionCode) { $releaseArgs += "-PversionCode=$VersionCode" }
if ($VersionName) { $releaseArgs += "-PversionName=$VersionName" }

function Find-Jdk17 {
    $candidates = @()
    if ($env:JAVA_HOME) { $candidates += $env:JAVA_HOME }
    $candidates += @(
        "C:\Program Files\Android\Android Studio\jbr",
        (Join-Path $projectRoot ".toolchains\android\jdk17")
    )
    foreach ($candidate in $candidates) {
        $java = Join-Path $candidate "bin\java.exe"
        if (Test-Path $java) {
            $previousPreference = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            $version = (& $java -version 2>&1 | Out-String)
            $ErrorActionPreference = $previousPreference
            if ($version -match 'version "17\.') { return $candidate }
        }
    }
    return $null
}

$jdkHome = Find-Jdk17
if (-not $jdkHome -and -not $SkipToolchainInstall) {
    & (Join-Path $androidRoot "tools\bootstrap-toolchain.ps1")
    $jdkHome = Find-Jdk17
}
if (-not $jdkHome) {
    throw "JDK 17 is required. Run apps/android/tools/bootstrap-toolchain.ps1 or set JAVA_HOME to a JDK 17 installation."
}
if (-not (Test-Path $sdkRoot)) {
    throw "Android SDK not found at $sdkRoot. Set ANDROID_HOME or install the Android SDK command-line tools."
}
if (-not (Test-Path (Join-Path $sdkRoot "platforms\android-36"))) {
    throw "Android SDK platform android-36 is missing at $sdkRoot. Install it with sdkmanager."
}

$env:JAVA_HOME = $jdkHome
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
if ($Release) {
    Push-Location $androidRoot
    try {
        & .\gradlew.bat validateReleaseSigning @releaseArgs
        if ($LASTEXITCODE -ne 0) { throw "Release signing validation failed." }
    } finally { Pop-Location }
    if ($ValidateOnly) { Write-Output "Release signing configuration is valid."; exit 0 }
}

# Build and bundle the browser frontend so the APK does not require the remote
# server to host HTML, JavaScript, CSS, or font assets.
Push-Location $projectRoot
try {
    & bun run webui:build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    # The Android app owns the server lifecycle, but the server itself still
    # runs as JavaScript under Bun's Android runtime. Build the two subprocess
    # entrypoints before bundling the main server so local sessions can spawn
    # them from the app-private server directory.
    Push-Location (Join-Path $projectRoot "packages\session-mcp-server")
    try {
        & bun run build
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
        Pop-Location
    }

    $serverAssetRoot = Join-Path $androidRoot "app\src\main\assets\server"
    if (Test-Path $serverAssetRoot) { Remove-Item -Recurse -Force $serverAssetRoot }
    New-Item -ItemType Directory -Force $serverAssetRoot | Out-Null

    # Keep the Android startup graph split into small ESM chunks. Loading the
    # previous 20+ MB single-file bundle can leave Bun compiling indefinitely
    # on some Android 12 vendor runtimes before the first JS statement runs.
    # Messaging is disabled in local Android mode, and Claude Code has no
    # Android native executable, so neither dependency belongs in the APK's
    # eager server graph.
    & bun build `
        --target=bun `
        --format=esm `
        --splitting `
        --external=markitdown-js `
        --external=sharp `
        --external=@craft-agent/messaging-gateway `
        --external=@anthropic-ai/claude-agent-sdk `
        --entry-naming=server.js `
        --chunk-naming=chunks/[name]-[hash].[ext] `
        --outdir=$serverAssetRoot `
        (Join-Path $projectRoot "packages\server\src\index.ts")
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    # Static imports still reference the Claude SDK even though Android rejects
    # Claude sessions before use. Resolve those imports to a tiny fail-fast ESM
    # shim instead of parsing and shipping the 1.8 MB desktop SDK.
    $claudeStubSource = Join-Path $androidRoot "runtime-stubs\anthropic-claude-agent-sdk"
    $claudeStubDest = Join-Path $serverAssetRoot "node_modules\@anthropic-ai\claude-agent-sdk"
    New-Item -ItemType Directory -Force (Split-Path -Parent $claudeStubDest) | Out-Null
    Copy-Item -LiteralPath $claudeStubSource -Destination $claudeStubDest -Recurse -Force

    $resourceRoot = Join-Path $serverAssetRoot "resources"
    New-Item -ItemType Directory -Force $resourceRoot | Out-Null
    $electronResourceRoot = Join-Path $projectRoot "apps\electron\resources"
    foreach ($resourceName in @("config-defaults.json", "docs", "permissions", "skills", "themes", "tool-icons")) {
        $resourceSource = Join-Path $electronResourceRoot $resourceName
        if (Test-Path $resourceSource) {
            Copy-Item $resourceSource (Join-Path $resourceRoot $resourceName) -Recurse -Force
        }
    }

    # Pi and session MCP are spawned by the server using the Android Bun
    # executable, so they must be present in the extracted server root.
    $piDest = Join-Path $resourceRoot "pi-agent-server"
    $sessionDest = Join-Path $resourceRoot "session-mcp-server"
    New-Item -ItemType Directory -Force $piDest, $sessionDest | Out-Null
    # Android needs a Pi bundle without the desktop clipboard native loader.
    # Preserve all split chunks, including lazy provider/tool modules.
    & bun (Join-Path $androidRoot "tools\build-pi-runtime.ts") $piDest
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Copy-Item (Join-Path $projectRoot "packages\session-mcp-server\dist\index.js") (Join-Path $sessionDest "index.js") -Force

    $bridgeSource = Join-Path $electronResourceRoot "bridge-mcp-server\index.js"
    if (Test-Path $bridgeSource) {
        $bridgeDest = Join-Path $resourceRoot "bridge-mcp-server"
        New-Item -ItemType Directory -Force $bridgeDest | Out-Null
        Copy-Item $bridgeSource (Join-Path $bridgeDest "index.js") -Force
    }
    # The marker must follow the server bundle as well as Bun. A Bun-only
    # marker leaves stale server code installed when an app update keeps the
    # same runtime version.
    $bundleHashLines = Get-ChildItem -LiteralPath $serverAssetRoot -Recurse -File |
        Sort-Object FullName |
        ForEach-Object {
            $relative = $_.FullName.Substring($serverAssetRoot.Length).TrimStart("\", "/")
            "$relative`:$(Get-Sha256 $_.FullName)"
        }
    $bundleHashBytes = [Text.Encoding]::UTF8.GetBytes(($bundleHashLines -join "`n"))
    $bundleHasher = [Security.Cryptography.SHA256]::Create()
    try {
        $bundleHash = -join ($bundleHasher.ComputeHash($bundleHashBytes) | ForEach-Object { $_.ToString("x2") })
    } finally {
        $bundleHasher.Dispose()
    }
    Set-Content -Path (Join-Path $serverAssetRoot "version.txt") -Value "$bunAndroidVersion-$($bundleHash.Substring(0, 16))" -NoNewline

    # Bun publishes a native Android runtime rather than a Windows host
    # executable. Store it as a JNI library so Android extracts it into the
    # app's executable nativeLibraryDir; the Java launcher executes that file.
    $jniRoot = Join-Path $androidRoot "app\src\main\jniLibs\arm64-v8a"
    New-Item -ItemType Directory -Force $jniRoot | Out-Null
    $bunRuntime = Join-Path $jniRoot "libbun.so"
    $bunArchive = Join-Path $projectRoot ".toolchains\android\bun-linux-aarch64-android.zip"
    $bunExtractRoot = Join-Path $projectRoot ".toolchains\android\bun-linux-aarch64-android-$bunAndroidVersion"
    $bunSource = Join-Path $bunExtractRoot "bun-linux-aarch64-android\bun"
    if (-not (Test-Path $bunSource)) {
        if ($SkipServerRuntimeDownload) {
            throw "Android Bun runtime not found at $bunSource. Remove -SkipServerRuntimeDownload to download it."
        }
        New-Item -ItemType Directory -Force (Split-Path $bunArchive) | Out-Null
        if (-not (Test-Path $bunArchive)) {
            Write-Output "Downloading Bun Android runtime $bunAndroidVersion..."
            & curl.exe -L --fail --output $bunArchive "https://github.com/oven-sh/bun/releases/download/bun-v$bunAndroidVersion/bun-linux-aarch64-android.zip"
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        }
        Expand-Archive -Path $bunArchive -DestinationPath $bunExtractRoot -Force
    }
    if (-not (Test-Path $bunSource)) { throw "Bun Android runtime archive did not contain $bunSource." }
    Copy-Item $bunSource $bunRuntime -Force

    # Bun probes close_range(2) during startup. A few Android 12 vendor
    # seccomp profiles (including vivo PD1981) kill that syscall instead of
    # returning ENOSYS, so Bun never reaches its fallback. Build a tiny
    # LD_PRELOAD compatibility library that rejects only close_range before it
    # reaches the kernel. LocalAgentServer loads it for the Bun child process.
    $ndkRoot = Join-Path $sdkRoot "ndk"
    $ndk = Get-ChildItem -LiteralPath $ndkRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object { [version]$_.Name } -Descending |
        Select-Object -First 1
    if (-not $ndk) {
        throw "Android NDK is required to build the Bun seccomp compatibility library. Install it with sdkmanager 'ndk;28.2.13676358'."
    }
    $androidClang = Join-Path $ndk.FullName "toolchains\llvm\prebuilt\windows-x86_64\bin\aarch64-linux-android28-clang.cmd"
    if (-not (Test-Path $androidClang)) {
        throw "Android ARM64 compiler not found at $androidClang."
    }
    $compatSource = Join-Path $androidRoot "runtime\bun-seccomp-compat.c"
    $compatRuntime = Join-Path $jniRoot "libbun_seccomp_compat.so"
    & $androidClang -shared -fPIC -O2 -Wall -Wextra -Werror -o $compatRuntime $compatSource
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Output "Bundled Bun $bunAndroidVersion supports local mode on Android API 28 and newer; API 26/27 remain supported in remote mode."
} finally {
    Pop-Location
}
$assetRoot = Join-Path $androidRoot "app\src\main\assets\webui"
if (Test-Path -LiteralPath $assetRoot) {
    $resolvedAssetRoot = (Resolve-Path -LiteralPath $assetRoot).Path
    $expectedAssetRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "apps/android/app/src/main/assets/webui"))
    if ($resolvedAssetRoot -ne $expectedAssetRoot) { throw "Unexpected WebUI asset directory: $resolvedAssetRoot" }
    Remove-Item -LiteralPath $resolvedAssetRoot -Recurse -Force
}
New-Item -ItemType Directory -Force $assetRoot | Out-Null
$webuiDist = Join-Path $projectRoot "apps\webui\dist"
# Source maps are useful during web development but are not needed in the APK.
# Excluding them keeps the embedded WebView bundle small and avoids shipping
# several hundred MB of debugging data.
# Thousands of draw.io files make per-file PowerShell provider operations very
# slow on Windows. Robocopy batches the same copy and excludes source maps.
Write-Output "Bundling WebUI assets..."
& robocopy.exe $webuiDist $assetRoot /E /XF '*.map' /R:2 /W:1 /MT:8 /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw "WebUI asset copy failed (robocopy exit $LASTEXITCODE)." }

$env:JAVA_HOME = $jdkHome
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$tasks = if (-not $Release) { @("assembleDebug") } elseif ($Artifact -eq "Both") {
    @("assembleRelease", "bundleRelease")
} elseif ($Artifact -eq "Aab") { @("bundleRelease") } else { @("assembleRelease") }
# The WebView assets are replaced on every build. Clean first so Gradle's
# incremental ZIP packager cannot retain deleted hashed chunks as unreferenced
# data in the APK.
$gradleArgs = @("clean") + $tasks + @("-PserverUrl=$ServerUrl") + $releaseArgs
if (-not $Release -and $DebugApplicationIdSuffix) {
    $gradleArgs += "-PdebugApplicationIdSuffix=$DebugApplicationIdSuffix"
}

Push-Location $androidRoot
try {
    & .\gradlew.bat @gradleArgs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}

$variant = if ($Release) { "release" } else { "debug" }
$outputDir = Join-Path $projectRoot "dist\android"
New-Item -ItemType Directory -Force $outputDir | Out-Null
$outputs = @()
if ($Artifact -ne "Aab") {
    $apk = Join-Path $androidRoot "app\build\outputs\apk\$variant\app-$variant.apk"
    if (-not (Test-Path -LiteralPath $apk)) { throw "Gradle completed but no signed $variant APK was found." }
    $buildTools = Get-ChildItem -LiteralPath (Join-Path $sdkRoot "build-tools") -Directory |
        Where-Object { Test-Path (Join-Path $_.FullName "apksigner.bat") } |
        Sort-Object { [version]($_.Name -replace '-.*$', '') } -Descending | Select-Object -First 1
    if (-not $buildTools) { throw "Android SDK build-tools with apksigner and zipalign are required." }
    & (Join-Path $buildTools.FullName "zipalign.exe") -c -P 16 4 $apk
    if ($LASTEXITCODE -ne 0) { throw "APK alignment verification failed." }
    # Force a lower verifier range on release to actually exercise the v1
    # fallback as well as v2/v3, despite the app's higher manifest minSdk.
    $verifyArgs = @("verify", "--verbose", "--print-certs")
    if ($Release) { $verifyArgs += @("--min-sdk-version", "23") }
    $signatureReport = & (Join-Path $buildTools.FullName "apksigner.bat") @verifyArgs $apk
    if ($LASTEXITCODE -ne 0) { throw "APK signature verification failed." }
    $signatureReport | Write-Output
    if ($Release) {
        $reportText = $signatureReport -join "`n"
        foreach ($scheme in @("v1", "v2", "v3")) {
            if ($reportText -notmatch "Verified using $scheme scheme [^\r\n]*: true") {
                throw "Release APK did not verify using the required $scheme signature scheme."
            }
        }
    }
    $outputName = if (-not $Release -and $DebugApplicationIdSuffix) { "tokenbird-debug-device.apk" } else { "tokenbird-$variant.apk" }
    $outputs += @{ Source = $apk; Name = $outputName }
}
if ($Release -and $Artifact -ne "Apk") {
    $aab = Join-Path $androidRoot "app\build\outputs\bundle\release\app-release.aab"
    if (-not (Test-Path -LiteralPath $aab)) { throw "Gradle completed but no release AAB was found." }
    $verificationLog = Join-Path (Split-Path -Parent $aab) "signature-verification.txt"
    & (Join-Path $jdkHome "bin\jarsigner.exe") -verify $aab *> $verificationLog
    if ($LASTEXITCODE -ne 0) {
        Get-Content -LiteralPath $verificationLog -Tail 20 | Write-Output
        throw "AAB signature verification failed."
    }
    # jarsigner returns zero even for an unsigned archive. Require every payload
    # entry to carry a signature, and fully read entries to trigger verification.
    & (Join-Path $jdkHome "bin\java.exe") (Join-Path $androidRoot "tools\VerifyBundle.java") $aab
    if ($LASTEXITCODE -ne 0) { throw "AAB payload signature verification failed." }
    $outputs += @{ Source = $aab; Name = "tokenbird-release.aab" }
}
foreach ($output in $outputs) {
    $destination = Join-Path $outputDir $output.Name
    Copy-Item -LiteralPath $output.Source -Destination $destination -Force
    $hash = Get-Sha256 $destination
    Set-Content -LiteralPath "$destination.sha256" -Value "$hash  $($output.Name)" -Encoding ascii
    Write-Output "Artifact: $destination"
    Write-Output "SHA256: $hash"
}
