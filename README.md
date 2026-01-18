# S3 Web Browser

一个现代化的网页端 S3 存储浏览器，支持浏览、上传、下载和删除 S3 存储桶中的文件。

**纯客户端架构** - 无需服务器，可直接部署到静态网站托管服务。

## 功能特性

- 📁 **文件浏览**: 支持文件夹导航和文件列表查看（支持滚动加载）
- ⬆️ **文件上传**: 支持上传文件到当前目录
- ⬇️ **文件下载**: 支持下载文件（使用预签名 URL）
- 🔗 **签名URL**: 生成可自定义过期时间的签名URL
- 🗑️ **文件删除**: 支持删除文件和文件夹
- 🔄 **实时刷新**: 支持刷新当前目录
- 📱 **响应式设计**: 适配桌面和移动设备

## 技术栈

- **前端**: React + TypeScript + Vite
- **AWS SDK**: @aws-sdk/client-s3 (浏览器版本)
- **架构**: 纯客户端，无需后端服务器

## 安装步骤

1. **安装依赖**
   ```bash
   npm install
   ```

2. **启动开发服务器**
   ```bash
   npm run dev
   ```
   
   访问 http://localhost:3000

3. **构建生产版本**
   ```bash
   npm run build
   ```
   
   构建后的文件在 `dist` 目录，可以部署到任何静态网站托管服务：
   - GitHub Pages
   - Vercel
   - Netlify
   - Cloudflare Pages
   - 或任何支持静态文件的服务器

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

## 架构说明

### 纯客户端架构

本项目采用纯客户端架构，所有 S3 操作都在浏览器中直接完成：

- ✅ **无需服务器** - 可以直接部署到静态网站托管
- ✅ **直接调用 S3 API** - 使用 AWS SDK for JavaScript (浏览器版本)
- ✅ **配置本地存储** - S3 凭证保存在浏览器 localStorage 中

### 安全说明

⚠️ **重要提示**：
- AWS 凭证会存储在浏览器 localStorage 中
- 凭证会暴露在浏览器代码中（虽然经过打包，但仍可被查看）
- **不适合生产环境使用**
- **建议用于**：
  - 个人使用
  - 内网环境
  - 开发/测试环境
  - 使用临时凭证（STS）

### S3 配置

配置信息保存在浏览器 localStorage 中：

```typescript
{
  endpoint?: string;      // 可选，自定义 endpoint
  accessKeyId: string;     // 必填，访问密钥 ID
  secretAccessKey: string; // 必填，访问密钥
  region: string;         // 可选，区域，默认 us-east-1
}
```

## 支持的存储服务

- ✅ AWS S3（默认）
- ✅ MinIO
- ✅ 阿里云 OSS
- ✅ 腾讯云 COS
- ✅ 其他兼容 S3 API 的对象存储服务

## 注意事项

- **安全性**: 
  - ⚠️ AWS 凭证会暴露在浏览器中，请谨慎使用
  - 配置信息保存在浏览器 localStorage 中
  - 建议在公共计算机上使用后清除配置
  - 不适合在生产环境使用真实的生产凭证
  
- **权限**: 确保你的凭证有足够的权限访问指定的存储桶：
  - `s3:ListBucket` - 列出存储桶和对象
  - `s3:GetObject` - 下载文件
  - `s3:PutObject` - 上传文件
  - `s3:DeleteObject` - 删除文件
  
- **网络**: 
  - 使用自定义 endpoint 时，确保浏览器可以访问该 endpoint
  - 某些 S3 服务可能需要配置 CORS 允许浏览器访问
  
- **数据**: 
  - 上传的文件会保存到当前浏览的目录路径
  - 删除操作不可恢复，请谨慎操作
  
- **配置管理**: 
  - 可以随时点击 "⚙️ Configure" 修改配置
  - 点击 "🗑️ Clear Config" 清除保存的配置

## 许可证

MIT
