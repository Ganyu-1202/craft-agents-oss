param(
    [string]$KeystorePath = (Join-Path $env:LOCALAPPDATA "TokenBird/signing/release.p12"),
    [string]$KeyAlias = "tokenbird",
    [string]$DistinguishedName = "CN=TokenBird Release"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
$keytool = $null
foreach ($candidate in @($env:JAVA_HOME, (Join-Path $projectRoot ".toolchains/android/jdk17"))) {
    if ($candidate -and (Test-Path (Join-Path $candidate "bin/keytool.exe"))) {
        $keytool = Join-Path $candidate "bin/keytool.exe"
        break
    }
}
if (-not $keytool) { throw "Set JAVA_HOME or run apps/android/tools/bootstrap-toolchain.ps1 first." }
$keystoreFile = [IO.Path]::GetFullPath($KeystorePath)
if (Test-Path -LiteralPath $keystoreFile) { throw "Refusing to replace existing keystore: $keystoreFile" }
New-Item -ItemType Directory -Force (Split-Path -Parent $keystoreFile) | Out-Null

$previousPassword = $env:TOKENBIRD_KEYGEN_PASSWORD
try {
    if ($env:ANDROID_KEYSTORE_PASSWORD) {
        $env:TOKENBIRD_KEYGEN_PASSWORD = $env:ANDROID_KEYSTORE_PASSWORD
    } else {
        $password = Read-Host "New keystore password (at least 6 characters)" -AsSecureString
        $confirmation = Read-Host "Confirm password" -AsSecureString
        $plainPassword = [System.Net.NetworkCredential]::new("", $password).Password
        $plainConfirmation = [System.Net.NetworkCredential]::new("", $confirmation).Password
        if ($plainPassword -cne $plainConfirmation) { throw "Passwords do not match." }
        $env:TOKENBIRD_KEYGEN_PASSWORD = $plainPassword
        $plainPassword = $null
        $plainConfirmation = $null
    }
    if ($env:TOKENBIRD_KEYGEN_PASSWORD.Length -lt 6) { throw "Password must contain at least 6 characters." }
    & $keytool -genkeypair -noprompt -storetype PKCS12 -keystore $keystoreFile `
        -alias $KeyAlias -keyalg RSA -keysize 3072 -validity 10000 -dname $DistinguishedName `
        -storepass:env TOKENBIRD_KEYGEN_PASSWORD -keypass:env TOKENBIRD_KEYGEN_PASSWORD
    if ($LASTEXITCODE -ne 0) { throw "Release key generation failed." }
    Write-Output "Created keystore: $keystoreFile"
    Write-Output "Key alias: $KeyAlias"
    Write-Output "For PKCS12, set ANDROID_KEY_PASSWORD to the same value as ANDROID_KEYSTORE_PASSWORD."
} finally {
    $env:TOKENBIRD_KEYGEN_PASSWORD = $previousPassword
}
