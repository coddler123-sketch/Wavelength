# Code Signing

Wavelength uses `electron-builder` for Windows builds. The installer is unsigned unless a Windows code signing certificate is provided through environment variables.

## Required Secret Inputs

Set these outside the repository:

```powershell
$env:WIN_CSC_LINK = "C:\path\to\certificate.pfx"
$env:WIN_CSC_KEY_PASSWORD = "certificate-password"
```

`WIN_CSC_LINK` may also be an HTTPS URL supported by `electron-builder`.

Do not commit certificates, passwords, `.pfx`, `.p12`, or exported key material.

## Build A Signed Installer

```powershell
npm run signing:check
npm run build:signed
```

`build:signed` runs the signing environment check first, then runs the normal Windows NSIS build. If no certificate is configured, it fails before producing an accidentally unsigned release.

## Verify

After the build, inspect the installer signature:

```powershell
Get-AuthenticodeSignature "dist\Wavelength Setup <version>.exe"
```

Expected result for a signed release:

```text
Status : Valid
```

Unsigned local development builds are acceptable, but public release installers should be signed.
