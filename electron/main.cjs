const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const { join } = require('path');
const fs = require('fs');

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
    autoHideMenuBar: true, // 隐藏菜单栏
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

// IPC: 显示保存文件对话框
ipcMain.handle('show-save-dialog', async (event, options) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(window, {
    defaultPath: options.defaultPath,
    filters: options.filters || [{ name: 'All Files', extensions: ['*'] }],
  });
  return result;
});

// IPC: 写入文件（接收 ArrayBuffer）
ipcMain.handle('write-file', async (event, { filePath, data }) => {
  try {
    // data 是 ArrayBuffer，转换为 Buffer
    const buffer = Buffer.from(data);
    fs.writeFileSync(filePath, buffer);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// IPC: 追加写入文件（用于流式下载）
ipcMain.handle('append-file', async (event, { filePath, data }) => {
  try {
    const buffer = Buffer.from(data);
    fs.appendFileSync(filePath, buffer);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// IPC: 创建空文件（下载开始时）
ipcMain.handle('create-empty-file', async (event, { filePath }) => {
  try {
    fs.writeFileSync(filePath, '');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 当 Electron 完成初始化并准备创建浏览器窗口时调用
app.whenReady().then(() => {
  // 创建空菜单以完全移除菜单栏
  Menu.setApplicationMenu(null);

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
