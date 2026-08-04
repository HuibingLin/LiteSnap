<div align="center">

<img src="docs/images/icon.png" alt="LiteSnap" width="96" />

# LiteSnap

**截圖 · 標註 · 貼螢幕 · 搞定**

輕量快速的 macOS / Windows 截圖與標註工具。

[English](./README.md) · [简体中文](./README.zh-CN.md) · **繁體中文**

<br />

[![macOS](https://img.shields.io/badge/macOS-v1.0.0%20DMG-111111?style=flat-square&logo=apple&logoColor=white)](https://github.com/HuibingLin/LiteSnap/releases/download/v1.0.0/LiteSnap-1.0.0-arm64.dmg)
[![Windows](https://img.shields.io/badge/Windows-v1.0.0%20Setup-0078D4?style=flat-square&logo=windows&logoColor=white)](https://github.com/HuibingLin/LiteSnap/releases/download/v1.0.0/LiteSnap-1.0.0-setup.exe)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-6366f1?style=flat-square)](#下載)

</div>

---

## 下載

直接在本頁選擇版本與平台下載：

| 版本 | macOS（Apple 晶片） | Windows（x64 + ARM64） |
|:----:|:-------------------:|:----------------------:|
| **v1.0.0** | [LiteSnap-1.0.0-arm64.dmg](https://github.com/HuibingLin/LiteSnap/releases/download/v1.0.0/LiteSnap-1.0.0-arm64.dmg) | [LiteSnap-1.0.0-setup.exe](https://github.com/HuibingLin/LiteSnap/releases/download/v1.0.0/LiteSnap-1.0.0-setup.exe) |

> macOS 首次使用請在「系統設定 → 隱私權與安全性」中允許**螢幕錄製**。

---

## 簡介

按下全域快捷鍵，拖曳框選範圍，標註後即可複製、儲存或貼在螢幕上——幾秒完成。專注日常截圖與無縫長截圖。

## 預覽

<p align="center">
  <img src="docs/images/capture.png" alt="框選截圖" width="720" /><br />
  <em>框選範圍後可調整大小與位置，再開始標註</em>
</p>

<p align="center">
  <img src="docs/images/annotate.png" alt="標註工具" width="720" /><br />
  <em>矩形、畫筆、螢光筆、馬賽克、文字、表情貼圖等</em>
</p>

<p align="center">
  <img src="docs/images/scroll-capture.png" alt="捲動長截圖" width="720" /><br />
  <em>捲動長截圖，即時預覽拼接進度</em>
</p>

<p align="center">
  <img src="docs/images/pin.png" alt="貼在螢幕" width="720" /><br />
  <em>截圖以真實尺寸懸浮置頂，方便對照</em>
</p>

## 功能

- **全域快捷鍵** — 任意應用中喚起（macOS `⌥A`，Windows `Ctrl+Shift+A`，可自訂）
- **範圍可調** — 截圖後拖曳控制點改大小、拖曳內部移動位置
- **標註工具** — 矩形、橢圓、箭頭、畫筆、螢光筆、馬賽克、文字、表情貼圖
- **捲動長截圖** — 瀏覽器 / PDF / 聊天視窗無縫拼接，附即時預覽
- **貼在螢幕** — 截圖以真實尺寸懸浮置頂
- **系統匣常駐** — 不佔 Dock / 工作列；支援英文、簡體、繁體

## 開發

```bash
cd app
npm install
npm run dev
```

### 打包安裝包

```bash
cd app
npm run build:mac         # → dist/LiteSnap-*-arm64.dmg
npm run build:win         # → dist/LiteSnap-*-setup.exe  (x64 + arm64)
npm run build:win:x64     # → dist/LiteSnap-*-setup.exe  (僅 x64)
```

將 `app/dist/` 中的安裝包上傳到名為 `v1.0.0` 的 [GitHub Release](https://github.com/HuibingLin/LiteSnap/releases/new)（或在上方下載表中新增一列）。

### 技術棧

Electron · electron-vite · React 19 · TypeScript · Zustand · electron-builder

## 授權條款

[MIT](./LICENSE) © HuibingLin
