const { contextBridge, ipcRenderer } = require('electron');

// 暴露受保护的方法给渲染进程
contextBridge.exposeInMainWorld('electron', {
  // 平台信息
  platform: process.platform,

  // 显示保存文件对话框
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),

  // 写入文件（一次性写入）
  writeFile: (filePath, data) => ipcRenderer.invoke('write-file', { filePath, data }),

  // 追加写入文件（流式写入）
  appendFile: (filePath, data) => ipcRenderer.invoke('append-file', { filePath, data }),

  // 创建空文件
  createEmptyFile: (filePath) => ipcRenderer.invoke('create-empty-file', { filePath }),
});
