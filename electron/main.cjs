const { app, BrowserWindow } = require('electron');
const { join } = require('path');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
  });

  // 开发环境加载 Vite 开发服务器，生产环境加载构建后的文件
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 处理窗口关闭
  mainWindow.on('closed', () => {
    // 在 macOS 上，即使所有窗口关闭，应用通常继续运行
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

// 当 Electron 完成初始化并准备创建浏览器窗口时调用
app.whenReady().then(() => {
  createWindow();

  // macOS 特定行为：当点击 dock 图标且没有其他窗口打开时，重新创建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 除了 macOS 外，当所有窗口关闭时退出应用
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
