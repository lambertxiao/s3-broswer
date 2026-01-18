# S3 Web Browser

一个现代化的网页端 S3 存储浏览器，支持浏览、上传、下载和删除 S3 存储桶中的文件。

## 功能特性

- 📁 **文件浏览**: 支持文件夹导航和文件列表查看
- ⬆️ **文件上传**: 支持上传文件到当前目录
- ⬇️ **文件下载**: 支持下载文件（使用预签名 URL）
- 🗑️ **文件删除**: 支持删除文件和文件夹
- 🔄 **实时刷新**: 支持刷新当前目录
- 📱 **响应式设计**: 适配桌面和移动设备

## 技术栈

- **前端**: React + TypeScript + Vite
- **后端**: Node.js + Express + TypeScript
- **AWS SDK**: @aws-sdk/client-s3

## 安装步骤

1. **安装依赖**
   ```bash
   npm install
   ```

2. **启动开发服务器**
   ```bash
   npm run dev
   ```
   
   这将同时启动：
   - 前端开发服务器: http://localhost:3000
   - 后端 API 服务器: http://localhost:3001

4. **构建生产版本**
   ```bash
   npm run build
   npm run build:server
   npm start
   ```

## 使用说明

1. **配置 S3 连接**
   - 打开浏览器访问 http://localhost:3000
   - 首次使用时会自动弹出配置界面，或点击右上角的 "⚙️ Configure" 按钮
   - 填写以下信息：
     - **Endpoint** (可选): 自定义 S3 endpoint，留空则使用 AWS S3
       - MinIO 示例: `http://localhost:9000`
       - 阿里云 OSS 示例: `https://oss-cn-hangzhou.aliyuncs.com`
       - 腾讯云 COS 示例: `https://cos.ap-guangzhou.myqcloud.com`
     - **Bucket Name** (必填): 存储桶名称
     - **Access Key ID** (必填): 访问密钥 ID
     - **Secret Access Key** (必填): 访问密钥
     - **Region** (可选): 区域，默认为 `us-east-1`
   - 点击 "💾 Save & Connect" 保存配置并连接
   - 配置会自动保存到浏览器本地存储，下次访问时会自动加载

2. **浏览文件**
   - 使用面包屑导航在不同文件夹间切换
   - 点击文件夹名称进入该文件夹
   - 点击 "🔄 Refresh" 刷新当前目录

3. **文件操作**
   - **上传**: 点击 "📁 Select File" 选择文件，然后点击 "⬆️ Upload" 上传
   - **下载**: 点击文件行的 "⬇️ Download" 按钮下载文件
   - **删除**: 点击 "🗑️ Delete" 删除文件或文件夹（不可恢复，请谨慎操作）

## API 端点

所有 API 端点都需要在请求体中传递 S3 配置信息：

- `POST /api/list` - 获取文件列表
  - Body: `{ prefix: string, config: S3Config }`
- `POST /api/download` - 获取文件下载 URL
  - Body: `{ key: string, config: S3Config }`
- `POST /api/upload` - 上传文件（multipart/form-data）
  - FormData: `file`, `prefix`, `config` (JSON string)
- `POST /api/delete` - 删除文件
  - Body: `{ key: string, config: S3Config }`
- `POST /api/info` - 获取文件信息
  - Body: `{ key: string, config: S3Config }`

其中 `S3Config` 包含：
```typescript
{
  endpoint?: string;      // 可选，自定义 endpoint
  bucket: string;         // 必填，存储桶名称
  accessKeyId: string;     // 必填，访问密钥 ID
  secretAccessKey: string; // 必填，访问密钥
  region: string;         // 可选，区域
}
```

## 支持的存储服务

- ✅ AWS S3（默认）
- ✅ MinIO
- ✅ 阿里云 OSS
- ✅ 腾讯云 COS
- ✅ 其他兼容 S3 API 的对象存储服务

## 注意事项

- **安全性**: 配置信息保存在浏览器本地存储中，不会发送到服务器（除了 API 请求时）。建议在公共计算机上使用后清除配置
- **权限**: 确保你的凭证有足够的权限访问指定的存储桶（ListObjects, GetObject, PutObject, DeleteObject）
- **网络**: 使用自定义 endpoint 时，确保浏览器可以访问该 endpoint（注意 CORS 设置）
- **数据**: 上传的文件会保存到当前浏览的目录路径
- **删除**: 删除操作不可恢复，请谨慎操作
- **配置管理**: 可以随时点击 "⚙️ Configure" 修改配置，或点击 "🗑️ Clear Config" 清除保存的配置

## 许可证

MIT
