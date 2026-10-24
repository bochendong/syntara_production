# Desktop downloads

`/download` is a public page, linked from the homepage navigation. It offers a
Mac Apple Silicon ZIP only when its manifest and actual file are present. The
current package is the staging build, requires macOS 14+, and uses ad-hoc signing;
it has not been notarized by Apple. Windows and Intel Mac packages are unavailable.

## Build and package

From the repository root, using the macOS toolchain:

```sh
pnpm --filter @syntara/native desktop:build:staging
node scripts/deploy/package-macos-test.mjs
```

The packager verifies the app's bundle identifier, minimum system version, arm64
architecture, and code signature before creating the ZIP with `ditto`. It writes
the version, packaging time, filename, size, and SHA-256 to `macos-arm64.json`.
It does not install the app, publish a release, or upload files.

The default output directory is `.data/desktop-releases`, which is Git-ignored.
Set `SYNTARA_DESKTOP_RELEASES_DIR` to use another directory for both packaging and
the web server. Publishing source code alone does not publish the installer:
provision the manifest and ZIP in a persistent directory on the web server, then
point this variable at that directory. Never place credentials or environment
files in the package directory.

`GET /api/downloads/macos` streams the current ZIP as an attachment. `HEAD`, ETags,
and single byte ranges support file metadata checks and interrupted downloads.
Missing or invalid artifacts return 404; the page disables the download button.

## Verification

```sh
node --test scripts/maintenance/verify-desktop-download.test.mjs scripts/maintenance/verify-web-store-staging.test.mjs
curl -f http://localhost:3000/api/downloads/macos -o /tmp/syntara-mac.zip
shasum -a 256 /tmp/syntara-mac.zip
unzip -t /tmp/syntara-mac.zip
```

Compare the hash with the manifest or the checksum shown on the page. Also check
the homepage link, download button, and layout at desktop and phone widths.
