import { S3Client, ListBucketsCommand, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, CopyObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, GetObjectTaggingCommand, PutObjectTaggingCommand, GetBucketLifecycleConfigurationCommand, PutBucketLifecycleConfigurationCommand, DeleteBucketLifecycleCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Electron API 类型声明
declare global {
  interface Window {
    electron?: {
      platform: string;
      showSaveDialog: (options: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<{ canceled: boolean; filePath?: string }>;
      writeFile: (filePath: string, data: ArrayBuffer) => Promise<{ success: boolean; error?: string }>;
      appendFile: (filePath: string, data: ArrayBuffer) => Promise<{ success: boolean; error?: string }>;
      createEmptyFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
    };
  }
}

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
    // 自定义 User-Agent
    customUserAgent: 'Super S3 Browser/1.0.1',
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
  expiresIn: number = 3600,
  forceDownload: boolean = false
) {
  const s3Client = createS3Client(config);

  // 获取文件名
  const fileName = key.split('/').pop() || key;

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    // 如果需要强制下载，设置 Content-Disposition 为 attachment
    ...(forceDownload && {
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(fileName)}"`,
    }),
  });

  const url = await getSignedUrl(s3Client, command, { expiresIn });
  return url;
}

// 下载分片大小：5MB
const DOWNLOAD_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

// 并发下载文件到指定路径（Electron 环境）
export async function downloadFileToPath(
  config: S3Config,
  bucket: string,
  key: string,
  fileSize: number,
  filePath: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  // 先生成一个基础的 presigned URL（不带 Range）
  const baseUrl = await generateDownloadUrl(config, bucket, key, 3600, false);

  // 创建空文件
  if (window.electron) {
    await window.electron.createEmptyFile(filePath);
  }

  // 小文件直接下载
  if (fileSize < DOWNLOAD_CHUNK_SIZE) {
    const response = await fetch(baseUrl);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText}`);
    }
    const data = await response.arrayBuffer();

    if (window.electron) {
      const result = await window.electron.writeFile(filePath, data);
      if (!result.success) {
        throw new Error(result.error || 'Failed to write file');
      }
    }
    if (onProgress) onProgress(100);
    return;
  }

  // 大文件使用 Range 串行下载（直接写入文件，避免内存占用）
  const totalChunks = Math.ceil(fileSize / DOWNLOAD_CHUNK_SIZE);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * DOWNLOAD_CHUNK_SIZE;
    const end = Math.min(start + DOWNLOAD_CHUNK_SIZE - 1, fileSize - 1);

    // 使用 fetch 的 Range header 来请求分片
    const response = await fetch(baseUrl, {
      headers: {
        'Range': `bytes=${start}-${end}`,
      },
    });

    // 206 Partial Content 是正常的 Range 响应
    if (!response.ok && response.status !== 206) {
      throw new Error(`Failed to download chunk ${i}: ${response.statusText}`);
    }

    const chunkData = await response.arrayBuffer();

    // 追加写入文件
    if (window.electron) {
      const result = await window.electron.appendFile(filePath, chunkData);
      if (!result.success) {
        throw new Error(result.error || 'Failed to write chunk');
      }
    }

    if (onProgress) {
      const progress = Math.round(((i + 1) / totalChunks) * 100);
      onProgress(progress);
    }
  }
}


// 分片大小：5MB（S3 要求每个分片至少 5MB，除了最后一个）
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
// 并发上传数量
const CONCURRENT_UPLOADS = 4;

// 并发控制器：限制同时运行的 Promise 数量
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  onTaskComplete?: (completed: number, total: number) => void
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let currentIndex = 0;
  let completedCount = 0;

  const runTask = async (): Promise<void> => {
    while (currentIndex < tasks.length) {
      const index = currentIndex++;
      results[index] = await tasks[index]();
      completedCount++;
      if (onTaskComplete) {
        onTaskComplete(completedCount, tasks.length);
      }
    }
  };

  // 启动多个并发 worker
  const workers = Array(Math.min(concurrency, tasks.length))
    .fill(null)
    .map(() => runTask());

  await Promise.all(workers);
  return results;
}

// 上传文件（支持分片并发上传和进度回调）
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

  // 大文件使用分片并发上传
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

    // 3. 创建所有分片上传任务
    const uploadTasks: (() => Promise<{ ETag: string; PartNumber: number }>)[] = [];

    for (let partNumber = 1; partNumber <= totalChunks; partNumber++) {
      const start = (partNumber - 1) * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);
      const currentPartNumber = partNumber; // 闭包捕获

      uploadTasks.push(async () => {
        const chunkBuffer = await chunk.arrayBuffer();
        const uploadPartCommand = new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          PartNumber: currentPartNumber,
          UploadId: uploadId,
          Body: new Uint8Array(chunkBuffer),
        });

        const uploadPartResponse = await s3Client.send(uploadPartCommand);

        if (!uploadPartResponse.ETag) {
          throw new Error(`Failed to upload part ${currentPartNumber}`);
        }

        return {
          ETag: uploadPartResponse.ETag,
          PartNumber: currentPartNumber,
        };
      });
    }

    // 4. 并发执行上传任务
    const parts = await runWithConcurrency(
      uploadTasks,
      CONCURRENT_UPLOADS,
      (completed, total) => {
        if (onProgress) {
          const progress = Math.round((completed / total) * 90); // 90% 用于上传
          onProgress(progress);
        }
      }
    );

    // 5. 按 PartNumber 排序（S3 要求）
    parts.sort((a, b) => a.PartNumber - b.PartNumber);

    // 6. 完成分片上传
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

// 删除目录（先检查目录是否为空，为空才允许删除）
export async function deleteFolder(
  config: S3Config,
  bucket: string,
  folderKey: string
) {
  const s3Client = createS3Client(config);
  // 确保路径以 / 结尾
  const prefix = folderKey.endsWith('/') ? folderKey : `${folderKey}/`;

  // 使用 listObjects 检查目录下是否有对象（MaxKeys=2：一个可能是目录本身，另一个是子对象）
  const listCommand = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
    MaxKeys: 2,
  });

  const listResponse = await s3Client.send(listCommand);
  const contents = listResponse.Contents || [];

  // 过滤掉目录本身（即 key === prefix 的那个空对象）
  const childObjects = contents.filter(item => item.Key !== prefix);

  // 如果还有 CommonPrefixes（子目录）或子对象，则不允许删除
  if (childObjects.length > 0) {
    throw new Error('Directory is not empty. Please delete all files and subdirectories first.');
  }

  // 目录为空，删除目录对象本身
  const deleteCommand = new DeleteObjectCommand({
    Bucket: bucket,
    Key: prefix,
  });

  await s3Client.send(deleteCommand);
}

// 创建目录（在 S3 中通过创建一个以 / 结尾的空对象来模拟目录）
export async function createFolder(
  config: S3Config,
  bucket: string,
  folderPath: string
) {
  const s3Client = createS3Client(config);
  // 确保路径以 / 结尾
  const normalizedPath = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: normalizedPath,
    Body: new Uint8Array(0), // 空内容
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

// 修改对象的自定义 Metadata（通过 CopyObject 实现原地复制）
export async function updateObjectMetadata(
  config: S3Config,
  bucket: string,
  key: string,
  metadata: Record<string, string>
) {
  const s3Client = createS3Client(config);

  const command = new CopyObjectCommand({
    Bucket: bucket,
    Key: key,
    CopySource: encodeURIComponent(`${bucket}/${key}`),
    Metadata: metadata,
    MetadataDirective: 'REPLACE',
  });

  await s3Client.send(command);
}

// 修改对象的 Tags
export async function putObjectTags(
  config: S3Config,
  bucket: string,
  key: string,
  tags: Record<string, string>
) {
  const s3Client = createS3Client(config);

  const tagSet = Object.entries(tags).map(([k, v]) => ({
    Key: k,
    Value: v,
  }));

  const command = new PutObjectTaggingCommand({
    Bucket: bucket,
    Key: key,
    Tagging: {
      TagSet: tagSet,
    },
  });

  await s3Client.send(command);
}

// 生命周期规则接口
export interface LifecycleRule {
  id: string;
  prefix: string;
  status: 'Enabled' | 'Disabled';
  expirationDays?: number;
  noncurrentExpirationDays?: number;
  abortIncompleteMultipartUploadDays?: number;
  transitions?: Array<{
    days: number;
    storageClass: string;
  }>;
}

// 获取 Bucket 生命周期配置
export async function getBucketLifecycle(
  config: S3Config,
  bucket: string
): Promise<LifecycleRule[]> {
  const s3Client = createS3Client(config);

  try {
    const command = new GetBucketLifecycleConfigurationCommand({
      Bucket: bucket,
    });
    const response = await s3Client.send(command);

    return (response.Rules || []).map((rule: any) => ({
      id: rule.ID || '',
      prefix: rule.Filter?.Prefix || rule.Prefix || '',
      status: rule.Status || 'Enabled',
      expirationDays: rule.Expiration?.Days,
      noncurrentExpirationDays: rule.NoncurrentVersionExpiration?.NoncurrentDays,
      abortIncompleteMultipartUploadDays: rule.AbortIncompleteMultipartUpload?.DaysAfterInitiation,
      transitions: rule.Transitions?.map((t: any) => ({
        days: t.Days,
        storageClass: t.StorageClass,
      })),
    }));
  } catch (error: any) {
    // NoSuchLifecycleConfiguration 表示没有配置生命周期
    if (error.name === 'NoSuchLifecycleConfiguration' || error.Code === 'NoSuchLifecycleConfiguration') {
      return [];
    }
    throw error;
  }
}

// 保存 Bucket 生命周期配置
export async function putBucketLifecycle(
  config: S3Config,
  bucket: string,
  rules: LifecycleRule[]
) {
  const s3Client = createS3Client(config);

  if (rules.length === 0) {
    // 如果规则为空，删除生命周期配置
    const deleteCommand = new DeleteBucketLifecycleCommand({
      Bucket: bucket,
    });
    await s3Client.send(deleteCommand);
    return;
  }

  const s3Rules = rules.map(rule => {
    const s3Rule: any = {
      ID: rule.id,
      Filter: { Prefix: rule.prefix },
      Status: rule.status,
    };

    if (rule.expirationDays && rule.expirationDays > 0) {
      s3Rule.Expiration = { Days: rule.expirationDays };
    }

    if (rule.noncurrentExpirationDays && rule.noncurrentExpirationDays > 0) {
      s3Rule.NoncurrentVersionExpiration = { NoncurrentDays: rule.noncurrentExpirationDays };
    }

    if (rule.abortIncompleteMultipartUploadDays && rule.abortIncompleteMultipartUploadDays > 0) {
      s3Rule.AbortIncompleteMultipartUpload = { DaysAfterInitiation: rule.abortIncompleteMultipartUploadDays };
    }

    if (rule.transitions && rule.transitions.length > 0) {
      s3Rule.Transitions = rule.transitions.map(t => ({
        Days: t.days,
        StorageClass: t.storageClass,
      }));
    }

    return s3Rule;
  });

  const command = new PutBucketLifecycleConfigurationCommand({
    Bucket: bucket,
    LifecycleConfiguration: {
      Rules: s3Rules,
    },
  });

  await s3Client.send(command);
}
