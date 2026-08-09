<div align="center">

<img src="docs/images/icon.png" alt="LiteSnap" width="96" />

# LiteSnap

**截圖 · 標註 · 貼螢幕 · 搞定**

輕量快速的截圖與標註工具，現在先發布 Windows 版本。macOS 會在 Apple Developer 審核與公證完成後再上線。

[English](./README.md) · [简体中文](./README.zh-CN.md) · **繁體中文**

<br />

[![Windows](https://img.shields.io/badge/Windows-v2.0.0%20Setup-0078D4?style=flat-square&logo=windows&logoColor=white)](https://github.com/HuibingLin/LiteSnap/releases/download/v2.0.0/LiteSnap_2.0.0_x64-setup.exe)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20優先%20%2F%20macOS%20稍後-6366f1?style=flat-square)](#下載)

</div>

---

## 下載

**Windows 先上線。** 目前先發布 Windows 安裝包，方便直接提供給使用者下載。macOS 會在 Apple Developer 審核與公證完成後再開放。

最新版：**[v2.0.0](https://github.com/HuibingLin/LiteSnap/releases/tag/v2.0.0)** · [全部版本](https://github.com/HuibingLin/LiteSnap/releases)

| 版本 | Windows | macOS | 說明 |
|:----:|:-------:|:-----:|:-----|
| **v2.0.0** | [LiteSnap_2.0.0_x64-setup.exe](https://github.com/HuibingLin/LiteSnap/releases/download/v2.0.0/LiteSnap_2.0.0_x64-setup.exe) | 稍後上線 | 從 Electron 轉到 Tauri，安裝包更小、啟動更輕 |
| v1.0.1 | [LiteSnap-1.0.1-setup.exe](https://github.com/HuibingLin/LiteSnap/releases/download/v1.0.1/LiteSnap-1.0.1-setup.exe) | 即將推出 — 如需 macOS 請[提交 Issue](https://github.com/HuibingLin/LiteSnap/issues) | 舊版公開 Windows 版本 |

> macOS 目前暫停發布，等 Apple Developer 審核完成後再上線。Windows 使用者現在可以直接下載新版。

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

## 為什麼是 v2.0.0

- Electron 安裝包體積太大，所以 LiteSnap 轉到 Tauri，降低安裝包大小，也讓啟動更輕。
- Windows 版本先發布，這樣可以先把穩定的安裝包交給大家下載使用。
- macOS 會稍後上線，因為 Apple Developer 目前還在審核中，簽名與公證還沒完成。

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
npm run build:win         # → dist/LiteSnap_2.0.0_x64-setup.exe
npm run build:mac         # → dist/LiteSnap-2.0.0-*.dmg（macOS 後續發布）
```

## 發布 Windows 安裝包

1. 在 Windows 機器上打包：

   ```bash
   cd app
   npm install
   npm run build:win
   ```

2. 打包完成後，到這個目錄找安裝包：

   `app/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`

3. 在 GitHub 建立一個 Release，例如 `v2.0.0`。

4. 把 `LiteSnap_2.0.0_x64-setup.exe` 上傳到這個 Release。

5. 保留上面的下載表直鏈，這樣其他人可以直接點下載，不需要再進 Release 頁面找檔案。

## 授權條款

[MIT](./LICENSE) © HuibingLin
