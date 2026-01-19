# S3 Web Browser - Electron 桌面应用

这个项目可以使用 Electron 打包成桌面应用，支持 Windows、Linux 和 macOS。

## 安装依赖

首先安装 Electron 相关依赖：

```bash
npm install
```

**注意**：如果安装 Electron 时遇到网络超时问题（特别是在中国大陆），项目已配置了国内镜像源（`.npmrc` 文件）。如果仍然失败，可以尝试：

1. 使用代理：
   ```bash
   npm config set proxy http://your-proxy:port
   npm config set https-proxy http://your-proxy:port
   ```

2. 或者手动设置 Electron 镜像：
   ```bash
   npm config set electron_mirror https://npmmirror.com/mirrors/electron/
   npm config set electron_builder_binaries_mirror https://npmmirror.com/mirrors/electron-builder-binaries/
   ```

## 开发模式

在开发模式下运行 Electron 应用：

```bash
npm run electron:dev
```

这会同时启动 Vite 开发服务器和 Electron 窗口。

## 构建桌面应用

### 构建所有平台

```bash
npm run electron:build
```

### 构建特定平台

**Windows:**
```bash
npm run electron:build:win
```

**macOS:**
```bash
npm run electron:build:mac
```

**Linux:**
```bash
npm run electron:build:linux
```

## 输出文件

构建完成后，应用会输出到 `release` 目录：

- **Windows**: `release/S3 Web Browser Setup x.x.x.exe` (NSIS 安装程序)
- **macOS**: `release/S3 Web Browser-x.x.x.dmg` (DMG 安装包)
- **Linux**: `release/S3 Web Browser-x.x.x.AppImage` (AppImage 可执行文件)

## 注意事项

1. **图标文件**: 需要在 `build` 目录下放置应用图标：
   - Windows: `build/icon.ico`
   - macOS: `build/icon.icns`
   - Linux: `build/icon.png`

   如果没有图标文件，构建仍然可以成功，但会使用默认图标。

2. **跨平台构建**:
   - 在 Windows 上可以构建 Windows 版本
   - 在 macOS 上可以构建 macOS 和 Windows 版本
   - 在 Linux 上可以构建 Linux 版本
   - 要构建所有平台，建议在各自的系统上构建，或使用 CI/CD

3. **代码签名**: 如果要发布应用，建议配置代码签名（在 `package.json` 的 `build` 配置中添加签名相关配置）

## 项目结构

```
.
├── electron/          # Electron 主进程代码
│   ├── main.ts       # 主进程入口
│   └── preload.ts    # 预加载脚本
├── dist/             # Vite 构建输出
├── dist-electron/    # Electron 主进程构建输出
└── release/          # 打包后的应用
```
