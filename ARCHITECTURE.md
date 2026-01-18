# 架构说明

## 当前架构（CS架构）

当前项目使用客户端-服务器架构：
- **前端**：React 应用，运行在浏览器中
- **后端**：Node.js + Express 服务器，处理 S3 API 调用

### 为什么使用CS架构？

1. **安全性**
   - Secret Access Key 不会暴露在浏览器代码中
   - 凭证只在服务器端使用，更安全

2. **预签名URL生成**
   - 生成预签名URL需要 Secret Key
   - 不能在浏览器中安全地完成

3. **CORS问题**
   - 某些S3服务可能不允许浏览器直接访问
   - 通过服务器代理可以避免CORS问题

## 纯客户端架构

可以改为纯前端架构，但需要注意：

### 优点
- 不需要服务器，部署更简单
- 可以直接部署到静态网站托管（如 GitHub Pages, Vercel, Netlify）
- 减少服务器成本

### 缺点和风险
1. **安全风险**
   - AWS凭证会暴露在浏览器中
   - 任何人都可以通过浏览器开发者工具查看凭证
   - 不适合生产环境使用

2. **功能限制**
   - 预签名URL生成仍需要Secret Key（可以在前端做，但不安全）
   - 某些操作可能受CORS限制

3. **适用场景**
   - 个人使用或内网环境
   - 临时凭证（STS临时凭证）
   - 开发/测试环境

## 如何改为纯客户端

如果要改为纯客户端架构，需要：

1. 移除后端服务器代码
2. 在前端直接使用 AWS SDK for JavaScript v3
3. 用户在前端输入凭证（存储在localStorage）
4. 直接调用S3 API

### 示例代码结构

```typescript
// 前端直接使用 S3 Client
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  region: config.region,
  credentials: {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  },
  endpoint: config.endpoint,
  forcePathStyle: true,
});

// 直接调用API
const command = new ListBucketsCommand({});
const response = await s3Client.send(command);
```

## 建议

- **个人使用/内网**：可以使用纯客户端架构
- **生产环境/公网**：建议使用CS架构，或使用AWS Cognito等身份认证服务
- **混合方案**：敏感操作（如删除）通过服务器，只读操作（如列表）可以在前端
