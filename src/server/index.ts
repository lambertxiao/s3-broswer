import express from 'express';
import cors from 'cors';
import { S3Client, ListBucketsCommand, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import multer from 'multer';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// 配置 CORS
app.use(cors());
app.use(express.json());

// 配置 multer 用于文件上传
const upload = multer({ storage: multer.memoryStorage() });

// 根据配置创建 S3 客户端
function createS3Client(config: any) {
  const s3ClientConfig: any = {
    region: config.region || 'us-east-1',
    credentials: {
      accessKeyId: config.accessKeyId || '',
      secretAccessKey: config.secretAccessKey || '',
    },
    // 始终使用 path style 访问（适用于所有兼容 S3 的服务）
    forcePathStyle: true,
  };

  // 如果配置了自定义 endpoint，则使用它
  if (config.endpoint) {
    s3ClientConfig.endpoint = config.endpoint;
  }

  return new S3Client(s3ClientConfig);
}

// 获取所有 bucket 列表
app.post('/api/buckets', async (req, res) => {
  try {
    const { config } = req.body;
    
    if (!config || !config.accessKeyId || !config.secretAccessKey) {
      return res.status(400).json({ error: 'S3 configuration is required' });
    }

    const s3Client = createS3Client(config);
    const command = new ListBucketsCommand({});

    const response = await s3Client.send(command);
    
    const buckets = (response.Buckets || []).map(bucket => ({
      name: bucket.Name || '',
      creationDate: bucket.CreationDate || null,
    }));

    res.json({ buckets });
  } catch (error: any) {
    console.error('Error listing buckets:', error);
    res.status(500).json({ error: error.message || 'Failed to list buckets' });
  }
});

// 获取文件列表
app.post('/api/list', async (req, res) => {
  try {
    const { prefix = '', bucket, config, continuationToken, maxKeys = 100 } = req.body;
    
    if (!bucket) {
      return res.status(400).json({ error: 'Bucket name is required' });
    }
    
    if (!config || !config.accessKeyId || !config.secretAccessKey) {
      return res.status(400).json({ error: 'S3 configuration is required' });
    }

    const s3Client = createS3Client(config);
    const delimiter = '/';

    const command: any = {
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: delimiter,
      MaxKeys: maxKeys,
    };

    if (continuationToken) {
      command.ContinuationToken = continuationToken;
    }

    const response = await s3Client.send(new ListObjectsV2Command(command));

    const folders = (response.CommonPrefixes || []).map(commonPrefix => {
      const fullPath = commonPrefix.Prefix || '';
      const folderName = fullPath.replace(prefix, '').replace(delimiter, '');
      return {
        name: folderName,
        key: fullPath,
        type: 'folder' as const,
        size: 0,
        lastModified: null,
      };
    });

    const files = (response.Contents || [])
      .filter(item => item.Key !== prefix) // 排除当前目录本身
      .map(item => ({
        name: item.Key?.replace(prefix, '') || '',
        key: item.Key || '',
        type: 'file',
        size: item.Size || 0,
        lastModified: item.LastModified || null,
      }));

    res.json({
      folders,
      files,
      currentPath: prefix,
      continuationToken: response.NextContinuationToken || null,
      isTruncated: response.IsTruncated || false,
    });
  } catch (error: any) {
    console.error('Error listing objects:', error);
    res.status(500).json({ error: error.message || 'Failed to list objects' });
  }
});

// 获取文件下载 URL
app.post('/api/download', async (req, res) => {
  try {
    const { key, config } = req.body;
    
    if (!key) {
      return res.status(400).json({ error: 'Key parameter is required' });
    }
    
    if (!config || !config.accessKeyId || !config.secretAccessKey) {
      return res.status(400).json({ error: 'S3 configuration is required' });
    }
    
    if (!req.body.bucket) {
      return res.status(400).json({ error: 'Bucket name is required' });
    }

    const s3Client = createS3Client(config);
    const command = new GetObjectCommand({
      Bucket: req.body.bucket,
      Key: key,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    res.json({ url });
  } catch (error: any) {
    console.error('Error generating download URL:', error);
    res.status(500).json({ error: error.message || 'Failed to generate download URL' });
  }
});

// 生成签名 URL（支持自定义过期时间）
app.post('/api/sign-url', async (req, res) => {
  try {
    const { key, bucket, config, expiresIn = 3600 } = req.body;
    
    if (!key) {
      return res.status(400).json({ error: 'Key parameter is required' });
    }
    
    if (!bucket) {
      return res.status(400).json({ error: 'Bucket name is required' });
    }
    
    if (!config || !config.accessKeyId || !config.secretAccessKey) {
      return res.status(400).json({ error: 'S3 configuration is required' });
    }

    // 验证过期时间（1秒到7天之间）
    const expires = parseInt(expiresIn);
    if (isNaN(expires) || expires < 1 || expires > 604800) {
      return res.status(400).json({ error: 'Expires time must be between 1 second and 7 days (604800 seconds)' });
    }

    const s3Client = createS3Client(config);
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: expires });
    res.json({ url, expiresIn: expires });
  } catch (error: any) {
    console.error('Error generating signed URL:', error);
    res.status(500).json({ error: error.message || 'Failed to generate signed URL' });
  }
});

// 上传文件
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    let config;
    try {
      config = JSON.parse(req.body.config);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid config format' });
    }

    if (!config || !config.accessKeyId || !config.secretAccessKey) {
      return res.status(400).json({ error: 'S3 configuration is required' });
    }
    
    const bucket = req.body.bucket;
    if (!bucket) {
      return res.status(400).json({ error: 'Bucket name is required' });
    }

    const s3Client = createS3Client(config);
    const prefix = (req.body.prefix as string) || '';
    const key = prefix ? `${prefix}${req.file.originalname}` : req.file.originalname;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    });

    await s3Client.send(command);
    res.json({ message: 'File uploaded successfully', key });
  } catch (error: any) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: error.message || 'Failed to upload file' });
  }
});

// 删除文件
app.post('/api/delete', async (req, res) => {
  try {
    const { key, config } = req.body;
    
    if (!key) {
      return res.status(400).json({ error: 'Key parameter is required' });
    }
    
    if (!config || !config.accessKeyId || !config.secretAccessKey) {
      return res.status(400).json({ error: 'S3 configuration is required' });
    }
    
    if (!req.body.bucket) {
      return res.status(400).json({ error: 'Bucket name is required' });
    }

    const s3Client = createS3Client(config);
    const command = new DeleteObjectCommand({
      Bucket: req.body.bucket,
      Key: key,
    });

    await s3Client.send(command);
    res.json({ message: 'File deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: error.message || 'Failed to delete file' });
  }
});

// 获取文件信息
app.post('/api/info', async (req, res) => {
  try {
    const { key, config } = req.body;
    
    if (!key) {
      return res.status(400).json({ error: 'Key parameter is required' });
    }
    
    if (!config || !config.accessKeyId || !config.secretAccessKey) {
      return res.status(400).json({ error: 'S3 configuration is required' });
    }
    
    if (!req.body.bucket) {
      return res.status(400).json({ error: 'Bucket name is required' });
    }

    const s3Client = createS3Client(config);
    const command = new HeadObjectCommand({
      Bucket: req.body.bucket,
      Key: key,
    });

    const response = await s3Client.send(command);
    res.json({
      key,
      size: response.ContentLength,
      contentType: response.ContentType,
      lastModified: response.LastModified,
      etag: response.ETag,
    });
  } catch (error: any) {
    console.error('Error getting file info:', error);
    res.status(500).json({ error: error.message || 'Failed to get file info' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
