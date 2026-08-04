<div align="center">

<img src="docs/images/icon.png" alt="LiteSnap" width="96" />

# LiteSnap

**Capture. Annotate. Pin. Done.**

A fast, lightweight screenshot & annotation tool for macOS and Windows.

**English** · [简体中文](./README.zh-CN.md) · [繁體中文](./README.zh-TW.md)

<br />

[![macOS](https://img.shields.io/badge/macOS-v1.0.0%20DMG-111111?style=flat-square&logo=apple&logoColor=white)](https://github.com/HuibingLin/LiteSnap/releases/download/v1.0.0/LiteSnap-1.0.0-arm64.dmg)
[![Windows](https://img.shields.io/badge/Windows-v1.0.0%20Setup-0078D4?style=flat-square&logo=windows&logoColor=white)](https://github.com/HuibingLin/LiteSnap/releases/download/v1.0.0/LiteSnap-1.0.0-setup.exe)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-6366f1?style=flat-square)](#download)

</div>

---

## Download

Pick a version and platform — downloads start directly from this page:

| Version | macOS (Apple Silicon) | Windows (x64 + ARM64) |
|:-------:|:---------------------:|:---------------------:|
| **v1.0.0** | [LiteSnap-1.0.0-arm64.dmg](https://github.com/HuibingLin/LiteSnap/releases/download/v1.0.0/LiteSnap-1.0.0-arm64.dmg) | [LiteSnap-1.0.0-setup.exe](https://github.com/HuibingLin/LiteSnap/releases/download/v1.0.0/LiteSnap-1.0.0-setup.exe) |

> After installing on macOS, allow **Screen Recording** in System Settings → Privacy & Security.

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

## Develop

```bash
cd app
npm install
npm run dev
```

### Build installers

```bash
cd app
npm run build:mac         # → dist/LiteSnap-*-arm64.dmg
npm run build:win         # → dist/LiteSnap-*-setup.exe  (x64 + arm64)
npm run build:win:x64     # → dist/LiteSnap-*-setup.exe  (x64 only)
```

Upload files from `app/dist/` to a [GitHub Release](https://github.com/HuibingLin/LiteSnap/releases/new) named `v1.0.0` (or add a new row in the Download table above).

### Tech stack

Electron · electron-vite · React 19 · TypeScript · Zustand · electron-builder

## License

[MIT](./LICENSE) © HuibingLin
