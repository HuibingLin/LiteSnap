<div align="center">

<img src="docs/images/icon.png" alt="LiteSnap" width="96" />

# LiteSnap

**截圖 · 標註 · 貼螢幕 · 搞定**

輕量快速的 Windows 與 macOS 截圖、標註工具。

[English](./README.md) · [简体中文](./README.zh-CN.md) · **繁體中文**

<br />

[![Windows](https://img.shields.io/badge/Windows-v2.0.1%20Setup-0078D4?style=flat-square&logo=windows&logoColor=white)](https://github.com/HuibingLin/LiteSnap/releases/download/v2.0.1/LiteSnap_2.0.1_x64-setup.exe)
[![macOS](https://img.shields.io/badge/macOS-v2.0.1%20Universal%20DMG-000000?style=flat-square&logo=apple&logoColor=white)](https://github.com/HuibingLin/LiteSnap/releases/download/v2.0.1/LiteSnap_2.0.1_universal.dmg)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%2F%20macOS-6366f1?style=flat-square)](#下載)

</div>

---

## 下載

**Windows 與 macOS 現已開放下載。** macOS Universal DMG 已使用 Developer ID 簽署並通過 Apple 公證，同時支援 Apple Silicon 與 Intel Mac，最低支援 macOS 10.15。

最新版：**[v2.0.1](https://github.com/HuibingLin/LiteSnap/releases/tag/v2.0.1)** · [全部版本](https://github.com/HuibingLin/LiteSnap/releases)

| 版本 | Windows | macOS | 說明 |
|:----:|:-------:|:-----:|:-----|
| **v2.0.1** | [LiteSnap_2.0.1_x64-setup.exe](https://github.com/HuibingLin/LiteSnap/releases/download/v2.0.1/LiteSnap_2.0.1_x64-setup.exe) | [LiteSnap_2.0.1_universal.dmg](https://github.com/HuibingLin/LiteSnap/releases/download/v2.0.1/LiteSnap_2.0.1_universal.dmg) | Windows 貼圖更穩定、取消操作可恢復、適配不同 DPI 的真實尺寸，並正式提供已簽署和公證的 macOS Universal 版本 |
| v2.0.0 | [LiteSnap_2.0.0_x64-setup.exe](https://github.com/HuibingLin/LiteSnap/releases/download/v2.0.0/LiteSnap_2.0.0_x64-setup.exe) | 稍後上線 | 從 Electron 轉到 Tauri，安裝包更小、啟動更輕 |
| v1.0.1 | [LiteSnap-1.0.1-setup.exe](https://github.com/HuibingLin/LiteSnap/releases/download/v1.0.1/LiteSnap-1.0.1-setup.exe) | 即將推出 — 如需 macOS 請[提交 Issue](https://github.com/HuibingLin/LiteSnap/issues) | 舊版公開 Windows 版本 |

> macOS 首次啟動時會要求「螢幕與系統錄音」權限，以便 LiteSnap 擷取螢幕。安裝包已通過 Apple 公證，無需繞過 Gatekeeper 即可正常開啟。

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

## v2.0.1 修改與提升

- **Windows 貼圖更穩定** — 修正點擊貼圖後持續顯示「處理中」的問題，置頂貼圖視窗可以安全重用。
- **取消後可繼續截圖** — 取消操作會即時結束目前截圖流程，不再造成下一次全域快捷鍵失效。
- **貼圖保持真實尺寸** — Windows 在 100%、125%、150% 顯示縮放及多螢幕環境下，貼圖尺寸與所選截圖範圍一致。
- **調整大小更可控** — 只有使用者主動拖曳調整控制點時才修正長寬比，新貼圖不會錯誤套用上一張圖片的比例。
- **圖片傳輸更輕量** — Windows 使用單一 base64 載荷並在背景執行緒解碼，避免大量 JSON 陣列造成 WebView2 卡頓。
- **完整顯示截圖** — 貼圖邊框改為覆蓋繪製，不再擠壓或縮小圖片顯示範圍。

## 為什麼是 v2.0.0

- Electron 安裝包體積太大，所以 LiteSnap 轉到 Tauri，降低安裝包大小，也讓啟動更輕。
- Windows 版本先發布，以便盡快交付穩定安裝包並完成測試。
- Apple Developer 簽署與公證完成後，macOS 已在 v2.0.1 正式提供同時支援 Apple Silicon 與 Intel Mac 的 Universal DMG。

## 舊版技術棧說明

舊版技術棧：Electron · electron-vite · React 19 · TypeScript · Zustand · electron-builder

新版技術棧：Tauri 2 · Rust · React 19 · TypeScript · Zustand

## 開發

```bash
cd app
npm install
npm run dev
```

### 打包安裝包

```bash
cd app
npm run build:win         # → src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/LiteSnap_2.0.1_x64-setup.exe
npm run build:mac         # → src-tauri/target/release/bundle/macos/LiteSnap.app
npx tauri build --bundles dmg --target universal-apple-darwin
                          # → src-tauri/target/universal-apple-darwin/release/bundle/dmg/LiteSnap_2.0.1_universal.dmg
```

## 授權條款

[MIT](./LICENSE) © HuibingLin
