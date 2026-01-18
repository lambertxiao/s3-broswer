import { S3Client, ListBucketsCommand, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, GetObjectTaggingCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface S3Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

// 根据配置创建 S3 客户端
export function createS3Client(config: S3Config) {
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
export async function listBuckets(config: S3Config) {
  const s3Client = createS3Client(config);
  const command = new ListBucketsCommand({});
  const response = await s3Client.send(command);
  
  return (response.Buckets || []).map(bucket => ({
    name: bucket.Name || '',
    creationDate: bucket.CreationDate || null,
  }));
}

// 获取文件列表
export async function listObjects(
  config: S3Config,
  bucket: string,
  prefix: string = '',
  continuationToken?: string | null,
  maxKeys: number = 100
) {
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
      type: 'file' as const,
      size: item.Size || 0,
      lastModified: item.LastModified || null,
    }));

  return {
    folders,
    files,
    currentPath: prefix,
    continuationToken: response.NextContinuationToken || null,
    isTruncated: response.IsTruncated || false,
  };
}

// 生成下载 URL
export async function generateDownloadUrl(
  config: S3Config,
  bucket: string,
  key: string,
  expiresIn: number = 3600
) {
  const s3Client = createS3Client(config);
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const url = await getSignedUrl(s3Client, command, { expiresIn });
  return url;
}

// 分片大小：5MB（S3 要求每个分片至少 5MB，除了最后一个）
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

// 上传文件（支持分片上传和进度回调）
export async function uploadFile(
  config: S3Config,
  bucket: string,
  key: string,
  file: File,
  onProgress?: (progress: number) => void
) {
  const s3Client = createS3Client(config);
  
  // 小文件（小于 5MB）直接使用 PutObject
  if (file.size < CHUNK_SIZE) {
    const arrayBuffer = await file.arrayBuffer();
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: new Uint8Array(arrayBuffer),
      ContentType: file.type,
    });
    
    if (onProgress) {
      // 模拟进度
      onProgress(50);
      await s3Client.send(command);
      onProgress(100);
    } else {
      await s3Client.send(command);
    }
    return;
  }

  // 大文件使用分片上传
  let uploadId: string | undefined;
  
  try {
    // 1. 创建分片上传
    const createCommand = new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      ContentType: file.type,
    });
    const createResponse = await s3Client.send(createCommand);
    uploadId = createResponse.UploadId;
    
    if (!uploadId) {
      throw new Error('Failed to create multipart upload');
    }

    // 2. 计算分片数量
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const parts: Array<{ ETag: string; PartNumber: number }> = [];

    // 3. 上传每个分片
    for (let partNumber = 1; partNumber <= totalChunks; partNumber++) {
      const start = (partNumber - 1) * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);
      const chunkBuffer = await chunk.arrayBuffer();

      const uploadPartCommand = new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        PartNumber: partNumber,
        UploadId: uploadId,
        Body: new Uint8Array(chunkBuffer),
      });

      const uploadPartResponse = await s3Client.send(uploadPartCommand);
      
      if (!uploadPartResponse.ETag) {
        throw new Error(`Failed to upload part ${partNumber}`);
      }

      parts.push({
        ETag: uploadPartResponse.ETag,
        PartNumber: partNumber,
      });

      // 更新进度
      if (onProgress) {
        const progress = Math.round((partNumber / totalChunks) * 90); // 90% 用于上传，10% 用于完成
        onProgress(progress);
      }
    }

    // 4. 完成分片上传
    const completeCommand = new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts,
      },
    });

    await s3Client.send(completeCommand);
    
    if (onProgress) {
      onProgress(100);
    }
  } catch (error: any) {
    // 如果出错且已创建了分片上传，尝试取消
    if (uploadId) {
      try {
        const abortCommand = new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
        });
        await s3Client.send(abortCommand);
      } catch (abortError) {
        // 忽略取消错误
        console.error('Failed to abort multipart upload:', abortError);
      }
    }
    throw error;
  }
}

// 删除文件
export async function deleteObject(
  config: S3Config,
  bucket: string,
  key: string
) {
  const s3Client = createS3Client(config);
  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  await s3Client.send(command);
}

// 获取文件信息（包括metadata和tags）
export async function getObjectInfo(
  config: S3Config,
  bucket: string,
  key: string
) {
  const s3Client = createS3Client(config);
  
  // 获取基本信息
  const headCommand = new HeadObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  const headResponse = await s3Client.send(headCommand);
  
  // 提取自定义metadata（x-amz-meta- 开头的header）
  const metadata: Record<string, string> = {};
  if (headResponse.Metadata) {
    Object.keys(headResponse.Metadata).forEach(key => {
      metadata[key] = headResponse.Metadata![key] || '';
    });
  }
  
  // 获取tags
  let tags: Record<string, string> = {};
  try {
    const tagCommand = new GetObjectTaggingCommand({
      Bucket: bucket,
      Key: key,
    });
    const tagResponse = await s3Client.send(tagCommand);
    if (tagResponse.TagSet) {
      tagResponse.TagSet.forEach(tag => {
        if (tag.Key && tag.Value) {
          tags[tag.Key] = tag.Value;
        }
      });
    }
  } catch (error) {
    // 如果获取tags失败（可能没有权限或没有tags），忽略错误
    console.warn('Failed to get object tags:', error);
  }
  
  return {
    key,
    size: headResponse.ContentLength || 0,
    contentType: headResponse.ContentType,
    lastModified: headResponse.LastModified,
    etag: headResponse.ETag,
    metadata,
    tags,
  };
}
