<div align="center">

<img src="docs/images/icon.png" alt="LiteSnap" width="96" />

# LiteSnap

**Capture. Annotate. Pin. Done.**

A fast, lightweight screenshot & annotation tool for Windows first. macOS will ship later after Apple Developer review and notarization are ready.

**English** · [简体中文](./README.zh-CN.md) · [繁體中文](./README.zh-TW.md)

<br />

[![Windows](https://img.shields.io/badge/Windows-v2.0.0%20Setup-0078D4?style=flat-square&logo=windows&logoColor=white)](https://github.com/HuibingLin/LiteSnap/releases/download/v2.0.0/LiteSnap_2.0.0_x64-setup.exe)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20first%20%2F%20macOS%20later-6366f1?style=flat-square)](#download)

</div>

---

## Download

**Windows is live first.** The public release is Windows-only for now so we can ship the stable installer immediately. macOS will follow after Apple Developer review finishes.

Latest: **[v2.0.0](https://github.com/HuibingLin/LiteSnap/releases/tag/v2.0.0)** · [All releases](https://github.com/HuibingLin/LiteSnap/releases)

| Version | Windows | macOS | Notes |
|:-------:|:-------:|:-----:|:------|
| **v2.0.0** | [LiteSnap_2.0.0_x64-setup.exe](https://github.com/HuibingLin/LiteSnap/releases/download/v2.0.0/LiteSnap_2.0.0_x64-setup.exe) | Coming later | Migrated from Electron to Tauri for a much smaller installer and lighter startup |
| v1.0.1 | [LiteSnap-1.0.1-setup.exe](https://github.com/HuibingLin/LiteSnap/releases/download/v1.0.1/LiteSnap-1.0.1-setup.exe) | Coming soon — please [open an issue](https://github.com/HuibingLin/LiteSnap/issues) if you need macOS | Previous public Windows release |

> macOS is paused until Apple Developer approval is complete. Windows users can download the current release now.

---

## Overview

Press a global hotkey, drag out a region, mark it up, then copy, save, or pin it on screen — in a few seconds. Built for everyday screenshots and seamless long (scrolling) captures.

## Preview

<p align="center">
  <img src="docs/images/capture.png" alt="Region selection" width="720" /><br />
  <em>Select a region, then resize or move it before annotating</em>
</p>

<p align="center">
  <img src="docs/images/annotate.png" alt="Annotation tools" width="720" /><br />
  <em>Shapes, pen, highlighter, mosaic, text, and emoji stickers</em>
</p>

<p align="center">
  <img src="docs/images/scroll-capture.png" alt="Scroll capture" width="720" /><br />
  <em>Scroll capture with live preview while frames are stitched</em>
</p>

<p align="center">
  <img src="docs/images/pin.png" alt="Pin on screen" width="720" /><br />
  <em>Pin a screenshot as a floating, always-on-top window</em>
</p>

## Features

- **Global hotkey** — capture from any app (`⌥A` on macOS, `Ctrl+Shift+A` on Windows; fully customizable)
- **Adjustable region** — resize and move the crop after capture, before you annotate
- **Annotation tools** — rectangle, ellipse, arrow, pen, highlighter, mosaic, text, emoji
- **Scroll capture** — seamless long screenshots for browsers, PDFs, and chat apps, with a live preview
- **Pin on screen** — keep a capture floating at true size while you work
- **Tray-first** — stays out of the way until you need it; English / 简体中文 / 繁體中文

## Why v2.0.0

- Electron bundles were too large for the release experience we want, so LiteSnap moved to Tauri for a smaller installer and lighter runtime.
- Windows is shipping first so you can download and test the stable installer immediately.
- macOS will ship later, after Apple Developer review and notarization are ready.

## Migration Note

Previous stack: Electron · electron-vite · React 19 · TypeScript · Zustand · electron-builder

Current stack: Tauri 2 · Rust · React 19 · TypeScript · Zustand

## Develop

```bash
cd app
npm install
npm run dev
```

### Build installers

```bash
cd app
npm run build:win         # → dist/LiteSnap_2.0.0_x64-setup.exe
npm run build:mac         # → dist/LiteSnap-2.0.0-*.dmg (for later macOS release)
```

## Release Windows installer

1. Build the installer on Windows:

   ```bash
   cd app
   npm install
   npm run build:win
   ```

2. Find the installer in:

   `app/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`

3. Create a GitHub Release tag such as `v2.0.0`.

4. Upload `LiteSnap_2.0.0_x64-setup.exe` to that release.

5. Keep the direct download link in the table above so people can grab the installer without hunting through the release page.

## License

[MIT](./LICENSE) © HuibingLin
