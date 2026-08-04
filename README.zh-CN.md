<div align="center">

<img src="docs/images/icon.png" alt="LiteSnap" width="96" />

# LiteSnap

**截图 · 标注 · 贴屏 · 搞定**

轻量快速的 macOS / Windows 截图与标注工具。

[English](./README.md) · **简体中文** · [繁體中文](./README.zh-TW.md)

<br />

[![macOS](https://img.shields.io/badge/macOS-v1.0.0%20DMG-111111?style=flat-square&logo=apple&logoColor=white)](https://github.com/HuibingLin/LiteSnap/releases/download/v1.0.0/LiteSnap-1.0.0-arm64.dmg)
[![Windows](https://img.shields.io/badge/Windows-v1.0.0%20Setup-0078D4?style=flat-square&logo=windows&logoColor=white)](https://github.com/HuibingLin/LiteSnap/releases/download/v1.0.0/LiteSnap-1.0.0-setup.exe)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-6366f1?style=flat-square)](#下载)

</div>

---

## 下载

直接在本页选择版本和平台下载：

| 版本 | macOS（Apple 芯片） | Windows（x64 + ARM64） |
|:----:|:-------------------:|:----------------------:|
| **v1.0.0** | [LiteSnap-1.0.0-arm64.dmg](https://github.com/HuibingLin/LiteSnap/releases/download/v1.0.0/LiteSnap-1.0.0-arm64.dmg) | [LiteSnap-1.0.0-setup.exe](https://github.com/HuibingLin/LiteSnap/releases/download/v1.0.0/LiteSnap-1.0.0-setup.exe) |

> macOS 首次使用请在「系统设置 → 隐私与安全性」中允许**屏幕录制**。

---

## 简介

按下全局快捷键，拖拽框选区域，标注后即可复制、保存或贴到屏幕上——几秒完成。专注日常截图与无缝长截图。

## 预览

<p align="center">
  <img src="docs/images/capture.png" alt="框选截图" width="720" /><br />
  <em>框选区域后可调整大小与位置，再开始标注</em>
</p>

<p align="center">
  <img src="docs/images/annotate.png" alt="标注工具" width="720" /><br />
  <em>矩形、画笔、荧光笔、马赛克、文字、表情贴纸等</em>
</p>

<p align="center">
  <img src="docs/images/scroll-capture.png" alt="滚动长截图" width="720" /><br />
  <em>滚动长截图，实时预览拼接进度</em>
</p>

<p align="center">
  <img src="docs/images/pin.png" alt="贴在屏幕" width="720" /><br />
  <em>截图以真实尺寸悬浮置顶，方便对照</em>
</p>

## 功能

- **全局快捷键** — 任意应用中唤起（macOS `⌥A`，Windows `Ctrl+Shift+A`，可自定义）
- **区域可调** — 截图后拖动手柄改大小、拖动内部移动位置
- **标注工具** — 矩形、椭圆、箭头、画笔、荧光笔、马赛克、文字、表情贴纸
- **滚动长截图** — 浏览器 / PDF / 聊天窗口无缝拼接，带实时预览
- **贴在屏幕** — 截图以真实尺寸悬浮置顶
- **托盘常驻** — 不占 Dock / 任务栏；支持英文、简体、繁体

## 开发

```bash
cd app
npm install
npm run dev
```

### 打包安装包

```bash
cd app
npm run build:mac         # → dist/LiteSnap-*-arm64.dmg
npm run build:win         # → dist/LiteSnap-*-setup.exe  (x64 + arm64)
npm run build:win:x64     # → dist/LiteSnap-*-setup.exe  (仅 x64)
```

将 `app/dist/` 中的安装包上传到名为 `v1.0.0` 的 [GitHub Release](https://github.com/HuibingLin/LiteSnap/releases/new)（或在上方下载表中新增一行）。

### 技术栈

Electron · electron-vite · React 19 · TypeScript · Zustand · electron-builder

## 许可证

[MIT](./LICENSE) © HuibingLin
