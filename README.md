# haunt+ desktop

A Windows app that puts [haunt.gg](https://haunt.gg) and [haunt tools](https://www.haunt-tools.site) in one window. It runs the haunt+ userscript on the haunt.gg dashboard without Tampermonkey, and can upload screenshots to the haunt.gg Image Host.

Made by toutourina. Not affiliated with haunt.gg.

## Download

[haunt-plus-setup.exe](https://github.com/Toutourina0110/haunt-plus-releases/releases/latest/download/haunt-plus-setup.exe), or see [all releases](https://github.com/Toutourina0110/haunt-plus-releases/releases).

The installer is not code-signed, so Windows SmartScreen may warn you. Click **More info**, then **Run anyway**. Once installed, the app updates itself from this page.

## The source code

Everything the installer runs is in this repository, so you can check that the app does not steal your account or your token. Comments were removed; the code is otherwise unchanged. The current source matches release 1.0.3.

| Folder | What it is |
|---|---|
| `src/main` | The app itself: window, tray, settings, screenshots, Image Host uploads, updates |
| `src/preload` | The bridge between the app and its pages |
| `src/renderer` | The app's own pages: tab bar, settings, popups, Image Host gallery |
| `src/shared` | Types, translations, shortcuts |
| `resources/userscripts/haunt-plus.user.js` | The haunt+ userscript, injected on haunt.gg |
| `scripts/build.mjs` | Bundles the code above into the app |

## What the app connects to

- **haunt.gg**, shown as a normal website in its own window. You sign in on haunt.gg's own page. The app never reads your cookies or your password.
- **app.haunt-tools.site**, the haunt tools website, shown in the same way.
- **haunt.gg/api/imagehost**, only if you add an Image Host API key. The key is encrypted on your PC with Windows DPAPI and is only ever sent to haunt.gg (`src/main/imagehost.ts`).
- **GitHub**, to check this page for updates (`src/main/updater.ts`).
- **Fontshare**, for the fonts of the app's own pages.

The haunt+ userscript only talks to haunt.gg itself. It does not send data anywhere else.

## Build it yourself

With Node.js installed:

```
npm ci
npm run build
```

`npm ci` installs the exact versions listed in `package-lock.json`. The bundled JavaScript it builds in `dist/` (main process, preloads and pages) is byte for byte the same as in the installer of the same version. The userscript, CSS and HTML files differ only by their removed comments.
