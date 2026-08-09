# LiteSnap

A lightweight native screenshot utility built with Tauri 2, Rust, React and TypeScript.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

Install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating
system, including Rust and the platform webview toolchain.

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Production build

```bash
$ npm run build
```

Tauri writes native installers to `src-tauri/target/release/bundle`. Build on each target
operating system to produce its installer.
