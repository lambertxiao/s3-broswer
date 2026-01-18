# 上传和下载文件流程说明

## 当前实现

### 下载文件
**当前流程**：✅ **不经过服务器中转**
1. 前端请求 `/api/download`，传递文件key
2. 服务器生成预签名URL（使用Secret Key签名）
3. 前端直接使用预签名URL访问S3，下载文件
4. **文件数据不经过服务器**

**优点**：
- 服务器不承担文件传输流量
- 下载速度快（直接从S3下载）
- 服务器资源占用少

### 上传文件
**当前流程**：❌ **经过服务器中转**
1. 前端将文件上传到 `/api/upload`
2. 服务器接收文件（使用multer）
3. 服务器将文件上传到S3
4. **文件数据经过服务器中转**

**缺点**：
- 服务器需要接收完整文件，占用内存/磁盘
- 大文件上传会占用服务器带宽
- 服务器资源消耗大

## 优化方案

### 上传文件优化（使用预签名URL）

可以改为**不经过服务器中转**：

1. 前端请求 `/api/upload-url`，传递文件名和路径
2. 服务器生成预签名PUT URL
3. 前端直接使用预签名URL上传到S3
4. **文件数据不经过服务器**

**优点**：
- 服务器不承担文件传输流量
- 上传速度快（直接上传到S3）
- 支持大文件上传
- 服务器资源占用少

**实现示例**：
```typescript
// 后端：生成预签名PUT URL
app.post('/api/upload-url', async (req, res) => {
  const { key, bucket, config } = req.body;
  const command = new PutObjectCommand({ Bucket: bucket, Key: key });
  const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  res.json({ url });
});

// 前端：直接上传到S3
const response = await fetch('/api/upload-url', {
  method: 'POST',
  body: JSON.stringify({ key, bucket, config })
});
const { url } = await response.json();
await fetch(url, {
  method: 'PUT',
  body: file
});
```

## 总结

在CS架构下：
- ✅ **下载**：不需要中转（当前已实现）
- ❌ **上传**：当前经过中转，可以优化为不中转

**最佳实践**：
- 服务器只负责生成预签名URL（需要Secret Key）
- 文件传输直接在浏览器和S3之间进行
- 服务器不承担文件传输流量
