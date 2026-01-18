import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import {
  createS3Client,
  listBuckets,
  listObjects,
  generateDownloadUrl,
  uploadFile,
  deleteObject,
  getObjectInfo,
  type S3Config,
} from './s3Client';

interface FileItem {
  name: string;
  key: string;
  type: 'file' | 'folder';
  size: number;
  lastModified: string | null;
}

interface ListResponse {
  folders: FileItem[];
  files: FileItem[];
  currentPath: string;
  continuationToken?: string | null;
  isTruncated?: boolean;
}

// S3Config 已从 s3Client 导入

interface Bucket {
  name: string;
  creationDate: string | null;
}

const STORAGE_KEY = 's3_browser_config';

function App() {
  const [items, setItems] = useState<FileItem[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, { progress: number; status: 'pending' | 'uploading' | 'success' | 'error'; error?: string }>>({});
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState<S3Config>({
    endpoint: '',
    accessKeyId: '',
    secretAccessKey: '',
    region: 'us-east-1',
  });
  const [configValid, setConfigValid] = useState(false);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [selectedBucket, setSelectedBucket] = useState<string>('');
  const [loadingBuckets, setLoadingBuckets] = useState(false);
  const [continuationToken, setContinuationToken] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showSignUrlModal, setShowSignUrlModal] = useState(false);
  const [selectedFileForSign, setSelectedFileForSign] = useState<FileItem | null>(null);
  const [expiresIn, setExpiresIn] = useState<string>('3600');
  const [signedUrl, setSignedUrl] = useState<string>('');
  const [generatingUrl, setGeneratingUrl] = useState(false);
  const [selectedFileItem, setSelectedFileItem] = useState<FileItem | null>(null);
  const [bottomPanelTab, setBottomPanelTab] = useState<'details' | 'upload'>('details');
  const [bottomPanelExpanded, setBottomPanelExpanded] = useState(false);
  const [fileDetails, setFileDetails] = useState<{
    metadata: Record<string, string>;
    tags: Record<string, string>;
    contentType?: string;
    etag?: string;
  } | null>(null);
  const [loadingFileDetails, setLoadingFileDetails] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);

  // 判断文件是否可预览
  const isPreviewable = (fileName: string, contentType?: string): boolean => {
    const ext = fileName.toLowerCase().split('.').pop() || '';
    const previewableExtensions = [
      // 图片
      'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico',
      // 文本
      'txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'sh', 'bat', 'log', 'yaml', 'yml',
      // PDF
      'pdf',
      // 视频
      'mp4', 'webm', 'ogg',
      // 音频
      'mp3', 'wav', 'ogg', 'm4a'
    ];
    return previewableExtensions.includes(ext);
  };

  // 获取文件类型
  const getFileType = (fileName: string, contentType?: string): 'image' | 'text' | 'pdf' | 'video' | 'audio' | 'unknown' => {
    const ext = fileName.toLowerCase().split('.').pop() || '';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) return 'image';
    if (['txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'sh', 'bat', 'log', 'yaml', 'yml'].includes(ext)) return 'text';
    if (ext === 'pdf') return 'pdf';
    if (['mp4', 'webm', 'ogg'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return 'audio';
    return 'unknown';
  };

  // 加载预览
  const loadPreview = async (file: FileItem, contentType?: string) => {
    if (!isPreviewable(file.name, contentType)) {
      setPreviewUrl(null);
      setTextContent(null);
      return;
    }

    setLoadingPreview(true);
    setPreviewUrl(null);
    setTextContent(null);
    try {
      const url = await generateDownloadUrl(config, selectedBucket, file.key, 3600);
      setPreviewUrl(url);
      
      const fileType = getFileType(file.name, contentType);
      if (fileType === 'text') {
        // 对于文本文件，限制大小（比如最大1MB）
        if (file.size > 1024 * 1024) {
          setTextContent(null);
        } else {
          const response = await fetch(url);
          const text = await response.text();
          setTextContent(text);
        }
      } else {
        setTextContent(null);
      }
    } catch (err: any) {
      console.error('Failed to load preview:', err);
      setPreviewUrl(null);
      setTextContent(null);
    } finally {
      setLoadingPreview(false);
    }
  };

  // 打开预览弹窗
  const handlePreview = async (file: FileItem) => {
    if (!isPreviewable(file.name)) {
      alert('This file type cannot be previewed');
      return;
    }
    
    setPreviewFile(file);
    setShowPreviewModal(true);
    setPreviewUrl(null);
    setTextContent(null);
    
    // 获取文件信息以获取contentType
    try {
      const info = await getObjectInfo(config, selectedBucket, file.key);
      await loadPreview(file, info.contentType);
    } catch (err: any) {
      console.error('Failed to load file info for preview:', err);
      // 即使获取info失败，也尝试加载预览
      await loadPreview(file);
    }
  };

  const loadFiles = async (path: string = '', bucket?: string, append: boolean = false) => {
    const bucketToUse = bucket || selectedBucket;
    if (!configValid || !bucketToUse) {
      setError('Please select a bucket first');
      return;
    }
    
    // 如果是追加模式（滚动加载），使用 loadingMore，否则使用 loading
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setError(null);
    }
    
    try {
      const data = await listObjects(
        config,
        bucketToUse,
        path,
        append ? continuationToken : undefined,
        100
      );
      
      if (append) {
        // 追加模式：追加到现有列表，并去重
        setItems(prev => {
          const existingKeys = new Set(prev.map(item => item.key));
          const newItems = [...data.folders, ...data.files].filter(item => !existingKeys.has(item.key));
          return [...prev, ...newItems];
        });
      } else {
        // 新加载：替换列表
        setItems([...data.folders, ...data.files]);
      }
      
      setCurrentPath(data.currentPath);
      setContinuationToken(data.continuationToken || null);
      setHasMore(data.isTruncated || false);
    } catch (err: any) {
      setError(err.message || 'Failed to load files');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // 加载更多文件（滚动加载）
  const loadMoreFiles = useCallback(async () => {
    if (loadingMore || !hasMore || !continuationToken || loading || !configValid || !selectedBucket) {
      return;
    }
    
    setLoadingMore(true);
    setError(null);
    
    try {
      const data = await listObjects(
        config,
        selectedBucket,
        currentPath,
        continuationToken,
        100
      );
      
      // 追加数据时去重，避免重复的 key
      setItems(prev => {
        const existingKeys = new Set(prev.map(item => item.key));
        const newItems = [...data.folders, ...data.files].filter(item => !existingKeys.has(item.key));
        return [...prev, ...newItems];
      });
      setContinuationToken(data.continuationToken || null);
      setHasMore(data.isTruncated || false);
    } catch (err: any) {
      setError(err.message || 'Failed to load files');
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, continuationToken, currentPath, loading, configValid, selectedBucket, config]);

  // 加载保存的配置
  useEffect(() => {
    const savedConfig = localStorage.getItem(STORAGE_KEY);
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        setConfig(parsed);
        setConfigValid(!!(parsed.accessKeyId && parsed.secretAccessKey));
        if (parsed.accessKeyId && parsed.secretAccessKey) {
          loadBuckets();
        }
      } catch (e) {
        console.error('Failed to load config:', e);
      }
    } else {
      setShowConfig(true);
    }
  }, []);

  // 加载 bucket 列表
  const loadBuckets = async () => {
    if (!configValid) {
      return;
    }
    setLoadingBuckets(true);
    setError(null);
    try {
      const bucketsList = await listBuckets(config);
      setBuckets(bucketsList);
    } catch (err: any) {
      setError(err.message || 'Failed to load buckets');
    } finally {
      setLoadingBuckets(false);
    }
  };

  // 当配置有效时自动加载 bucket 列表
  useEffect(() => {
    if (configValid) {
      loadBuckets();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configValid]);

  // 滚动加载更多
  const fileListRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const fileListContainer = fileListRef.current;
    if (!fileListContainer) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = fileListContainer;
      // 当滚动到距离底部 100px 时，触发加载更多
      if (scrollHeight - scrollTop - clientHeight < 100) {
        loadMoreFiles();
      }
    };

    fileListContainer.addEventListener('scroll', handleScroll);
    return () => {
      fileListContainer.removeEventListener('scroll', handleScroll);
    };
  }, [loadMoreFiles]);

  const handleFolderClick = (folder: FileItem) => {
    setContinuationToken(null);
    setHasMore(false);
    loadFiles(folder.key);
  };

  const handleBreadcrumbClick = (path: string) => {
    // 确保路径格式正确
    // 空字符串或 '/' 表示根目录
    // 其他路径应该以 '/' 结尾（文件夹路径）
    let normalizedPath = path;
    if (path === '/' || path === '') {
      normalizedPath = '';
    } else if (!path.endsWith('/')) {
      // 如果路径不以 / 结尾，添加 /（确保是文件夹路径）
      normalizedPath = path + '/';
    }
    setContinuationToken(null);
    setHasMore(false);
    loadFiles(normalizedPath);
  };

  const handleDownload = async (file: FileItem) => {
    try {
      const url = await generateDownloadUrl(config, selectedBucket, file.key);
      window.open(url, '_blank');
    } catch (err: any) {
      alert(err.message || 'Failed to generate download URL');
    }
  };

  const handleDelete = async (item: FileItem) => {
    if (!confirm(`Are you sure you want to delete ${item.name}?`)) {
      return;
    }
    try {
      await deleteObject(config, selectedBucket, item.key);
      loadFiles(currentPath);
    } catch (err: any) {
      alert(err.message || 'Failed to delete file');
    }
  };

  const handleGenerateSignUrl = (item: FileItem) => {
    setSelectedFileForSign(item);
    setExpiresIn('3600');
    setSignedUrl('');
    setShowSignUrlModal(true);
  };

  const generateSignUrl = async () => {
    if (!selectedFileForSign) return;
    
    const expires = parseInt(expiresIn);
    if (isNaN(expires) || expires < 1 || expires > 604800) {
      alert('Expires time must be between 1 second and 7 days (604800 seconds)');
      return;
    }

    setGeneratingUrl(true);
    try {
      const url = await generateDownloadUrl(config, selectedBucket, selectedFileForSign.key, expires);
      setSignedUrl(url);
    } catch (err: any) {
      alert(err.message || 'Failed to generate signed URL');
    } finally {
      setGeneratingUrl(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      // 复制成功，不显示弹窗
    } catch (err) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        // 复制成功，不显示弹窗
      } catch (e) {
        // 复制失败时也不显示弹窗，静默处理
      }
      document.body.removeChild(textArea);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      setSelectedFiles(prev => [...prev, ...files]);
      // 初始化上传进度
      const newProgress: Record<string, { progress: number; status: 'pending' | 'uploading' | 'success' | 'error'; error?: string }> = {};
      files.forEach(file => {
        newProgress[file.name] = { progress: 0, status: 'pending' };
      });
      setUploadProgress(prev => ({ ...prev, ...newProgress }));
    }
  };

  const removeFile = (fileName: string) => {
    setSelectedFiles(prev => prev.filter(f => f.name !== fileName));
    setUploadProgress(prev => {
      const newProgress = { ...prev };
      delete newProgress[fileName];
      return newProgress;
    });
  };

  const clearSelectedFiles = () => {
    setSelectedFiles([]);
    setUploadProgress({});
    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) {
      alert('Please select at least one file');
      return;
    }

    setUploading(true);
    
    // 上传所有文件
    const uploadPromises = selectedFiles.map(async (file) => {
      const key = currentPath ? `${currentPath}${file.name}` : file.name;
      
      // 更新状态为上传中
      setUploadProgress(prev => ({
        ...prev,
        [file.name]: { progress: 0, status: 'uploading' }
      }));

      try {
        await uploadFile(
          config, 
          selectedBucket, 
          key, 
          file,
          (progress) => {
            // 更新上传进度
            setUploadProgress(prev => ({
              ...prev,
              [file.name]: { progress, status: 'uploading' }
            }));
          }
        );
        
        // 更新状态为成功
        setUploadProgress(prev => ({
          ...prev,
          [file.name]: { progress: 100, status: 'success' }
        }));
      } catch (err: any) {
        // 更新状态为错误
        setUploadProgress(prev => ({
          ...prev,
          [file.name]: { progress: 0, status: 'error', error: err.message || 'Failed to upload file' }
        }));
        throw err;
      }
    });

    try {
      await Promise.all(uploadPromises);
      // 延迟清除，让用户看到成功状态
      setTimeout(() => {
        clearSelectedFiles();
        loadFiles(currentPath);
      }, 1000);
    } catch (err) {
      // 部分文件可能上传失败，但不清除列表，让用户看到哪些失败了
    } finally {
      setUploading(false);
    }
  };

  const handleConfigChange = (field: keyof S3Config, value: string) => {
    const newConfig = { ...config, [field]: value };
    setConfig(newConfig);
    setConfigValid(!!(newConfig.accessKeyId && newConfig.secretAccessKey));
  };

  const handleSaveConfig = async () => {
    if (!config.accessKeyId || !config.secretAccessKey) {
      alert('Please fill in all required fields');
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    setShowConfig(false);
    setConfigValid(true);
    await loadBuckets();
  };

  const handleClearConfig = () => {
    localStorage.removeItem(STORAGE_KEY);
    setConfig({
      endpoint: '',
      accessKeyId: '',
      secretAccessKey: '',
      region: 'us-east-1',
    });
    setConfigValid(false);
    setBuckets([]);
    setSelectedBucket('');
    setItems([]);
    setCurrentPath('');
  };

  const handleBucketSelect = (bucketName: string) => {
    setSelectedBucket(bucketName);
    setItems([]);
    setCurrentPath('');
    setError(null);
    setContinuationToken(null);
    setHasMore(false);
    // 直接传递 bucketName，避免状态更新延迟问题
    loadFiles('', bucketName);
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (date: string | null): string => {
    if (!date) return '-';
    return new Date(date).toLocaleString();
  };

  const breadcrumbs = currentPath
    ? ['', ...currentPath.split('/').filter(Boolean)]
    : [''];
  
  // 构建面包屑路径的辅助函数
  const getBreadcrumbPath = (index: number): string => {
    if (index === 0) {
      return ''; // 根目录
    }
    const parts = breadcrumbs.slice(1, index + 1);
    return parts.join('/') + '/'; // 确保路径以 / 结尾（S3 文件夹路径格式）
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>📦 S3 Browser</h1>
        <button onClick={() => setShowConfig(true)} className="btn btn-config">
          ⚙️ Configure
        </button>
      </header>

      {showConfig && (
        <div className="config-modal">
          <div className="config-content">
            <h2>S3 Configuration</h2>
            <div className="config-form">
              <div className="form-group">
                <label>Endpoint (可选，留空使用 AWS S3)</label>
                <input
                  type="text"
                  placeholder="http://localhost:9000 or https://oss-cn-hangzhou.aliyuncs.com"
                  value={config.endpoint}
                  onChange={(e) => handleConfigChange('endpoint', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Access Key ID <span className="required">*</span></label>
                <input
                  type="text"
                  placeholder="your-access-key-id"
                  value={config.accessKeyId}
                  onChange={(e) => handleConfigChange('accessKeyId', e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>Secret Access Key <span className="required">*</span></label>
                <input
                  type="password"
                  placeholder="your-secret-access-key"
                  value={config.secretAccessKey}
                  onChange={(e) => handleConfigChange('secretAccessKey', e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>Region</label>
                <input
                  type="text"
                  placeholder="us-east-1"
                  value={config.region}
                  onChange={(e) => handleConfigChange('region', e.target.value)}
                />
              </div>
              <div className="config-actions">
                <button onClick={handleSaveConfig} className="btn btn-primary">
                  💾 Save & Connect
                </button>
                <button onClick={() => setShowConfig(false)} className="btn btn-secondary">
                  Cancel
                </button>
                {configValid && (
                  <button onClick={handleClearConfig} className="btn btn-danger">
                    🗑️ Clear Config
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {!configValid ? (
        <div className="app-content">
          <div className="empty-message" style={{ padding: '60px', textAlign: 'center' }}>
            Please configure S3 connection to start browsing
          </div>
        </div>
      ) : (
        <div className="main-layout">
          {/* 左侧：Bucket 列表 */}
          <div className="sidebar">
            <div className="sidebar-header">
              <h3>Buckets</h3>
              <button onClick={loadBuckets} className="btn btn-sm btn-refresh" title="Refresh buckets">
                🔄
              </button>
            </div>
            <div className="sidebar-content">
              {loadingBuckets ? (
                <div className="loading">Loading buckets...</div>
              ) : buckets.length === 0 ? (
                <div className="empty-message">No buckets found</div>
              ) : (
                <div className="bucket-list">
                  {buckets.map((bucket) => (
                    <button
                      key={bucket.name}
                      onClick={() => handleBucketSelect(bucket.name)}
                      className={`bucket-item ${selectedBucket === bucket.name ? 'active' : ''}`}
                    >
                      <span className="bucket-icon">🪣</span>
                      <div className="bucket-info">
                        <div className="bucket-name">{bucket.name}</div>
                        {bucket.creationDate && (
                          <div className="bucket-date">
                            {formatDate(bucket.creationDate)}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 右侧：文件列表 */}
          <div className="main-content">
            {selectedBucket ? (
              <>
                <div className="content-header">
                  <div className="toolbar">
                    <div className="upload-section">
                      <input
                        id="file-input"
                        type="file"
                        multiple
                        onChange={handleFileSelect}
                        style={{ display: 'none' }}
                      />
                      <button
                        onClick={() => document.getElementById('file-input')?.click()}
                        className="btn btn-primary"
                      >
                        📁 Select Files
                      </button>
                      {selectedFiles.length > 0 && (
                        <>
                          <button
                            onClick={handleUpload}
                            disabled={uploading}
                            className="btn btn-upload"
                          >
                            {uploading ? 'Uploading...' : `⬆️ Upload ${selectedFiles.length} File${selectedFiles.length > 1 ? 's' : ''}`}
                          </button>
                          <button
                            onClick={clearSelectedFiles}
                            className="btn btn-secondary"
                            disabled={uploading}
                          >
                            ✕ Clear
                          </button>
                        </>
                      )}
                    </div>
                    <button onClick={() => loadFiles(currentPath)} className="btn btn-refresh">
                      🔄 Refresh
                    </button>
                  </div>

                </div>

                <div className="breadcrumb">
                  {breadcrumbs.map((part, index) => {
                    const path = getBreadcrumbPath(index);
                    return (
                      <span key={index}>
                        {index > 0 && <span className="breadcrumb-separator"> / </span>}
                        <button
                          onClick={() => handleBreadcrumbClick(path)}
                          className="breadcrumb-link"
                        >
                          {part || 'Home'}
                        </button>
                      </span>
                    );
                  })}
                </div>

                {error && <div className="error-message">❌ {error}</div>}

                {loading && items.length === 0 ? (
                  <div className="loading">Loading...</div>
                ) : (
                  <div className="file-list" ref={fileListRef}>
                    <table>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Size</th>
                          <th>Last Modified</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="empty-message">
                              No files or folders found
                            </td>
                          </tr>
                        ) : (
                          <>
                            {items.map((item) => (
                              <tr key={item.key}>
                                <td>
                                  {item.type === 'folder' ? (
                                    <button
                                      onClick={() => handleFolderClick(item)}
                                      className="folder-link"
                                    >
                                      📁 {item.name}
                                    </button>
                                  ) : (
                                    <button
                                      onClick={async () => {
                                        setSelectedFileItem(item);
                                        setBottomPanelTab('details');
                                        setLoadingFileDetails(true);
                                        setFileDetails(null);
                                        try {
                                          const info = await getObjectInfo(config, selectedBucket, item.key);
                                          setFileDetails({
                                            metadata: info.metadata || {},
                                            tags: info.tags || {},
                                            contentType: info.contentType,
                                            etag: info.etag,
                                          });
                                        } catch (err: any) {
                                          console.error('Failed to load file details:', err);
                                          setFileDetails({
                                            metadata: {},
                                            tags: {},
                                          });
                                        } finally {
                                          setLoadingFileDetails(false);
                                        }
                                      }}
                                      className="file-name file-name-button"
                                      style={{ 
                                        background: 'none', 
                                        border: 'none', 
                                        padding: 0, 
                                        cursor: 'pointer',
                                        color: selectedFileItem?.key === item.key ? '#0969da' : 'inherit',
                                        fontWeight: selectedFileItem?.key === item.key ? 600 : 'normal',
                                        textAlign: 'left',
                                        width: '100%'
                                      }}
                                    >
                                      📄 {item.name}
                                    </button>
                                  )}
                                </td>
                                <td>{item.type === 'file' ? formatSize(item.size) : '-'}</td>
                                <td>{formatDate(item.lastModified)}</td>
                                <td>
                                  <div className="action-buttons">
                                    {item.type === 'file' && (
                                      <>
                                        {isPreviewable(item.name) && (
                                          <button
                                            onClick={() => handlePreview(item)}
                                            className="btn-icon btn-preview"
                                            title="Preview"
                                          >
                                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                              <path d="M8 3.5C4.5 3.5 2.5 6 1.5 8C2.5 10 4.5 12.5 8 12.5C11.5 12.5 13.5 10 14.5 8C13.5 6 11.5 3.5 8 3.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                              <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.5"/>
                                            </svg>
                                          </button>
                                        )}
                                        <button
                                          onClick={() => handleDownload(item)}
                                          className="btn-icon btn-download"
                                          title="Download"
                                        >
                                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M8 2.5V10.5M8 10.5L5.5 8M8 10.5L10.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                            <path d="M2.5 12.5H13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                          </svg>
                                        </button>
                                        <button
                                          onClick={() => handleGenerateSignUrl(item)}
                                          className="btn-icon btn-sign-url"
                                          title="Generate Signed URL"
                                        >
                                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M10.5 3.5L12.5 5.5L10.5 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                            <path d="M12.5 5.5H8.5C7.39543 5.5 6.5 6.39543 6.5 7.5V11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                            <path d="M5.5 12.5L3.5 10.5L5.5 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                            <path d="M3.5 10.5H7.5C8.60457 10.5 9.5 9.60457 9.5 8.5V4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                          </svg>
                                        </button>
                                        <button
                                          onClick={() => handleDelete(item)}
                                          className="btn-icon btn-delete"
                                          title="Delete"
                                        >
                                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M5.5 4.5V3.5C5.5 2.94772 5.94772 2.5 6.5 2.5H9.5C10.0523 2.5 10.5 2.94772 10.5 3.5V4.5M3.5 4.5H12.5M11.5 4.5V12.5C11.5 13.0523 11.0523 13.5 10.5 13.5H5.5C4.94772 13.5 4.5 13.0523 4.5 12.5V4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                            <path d="M6.5 7.5V10.5M9.5 7.5V10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                          </svg>
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                            {loadingMore && (
                              <tr>
                                <td colSpan={4} className="loading-more">
                                  Loading more...
                                </td>
                              </tr>
                            )}
                            {!hasMore && items.length > 0 && (
                              <tr>
                                <td colSpan={4} className="no-more">
                                  No more files
                                </td>
                              </tr>
                            )}
                          </>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

              </>
            ) : (
              <div className="empty-state">
                <div className="empty-message" style={{ padding: '60px', textAlign: 'center' }}>
                  Select a bucket from the left to start browsing
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 生成签名URL对话框 */}
      {showSignUrlModal && (
        <div className="config-modal">
          <div className="config-content">
            <h2>Generate Signed URL</h2>
            {selectedFileForSign && (
              <div className="sign-url-form">
                <div className="form-group">
                  <label>File Name</label>
                  <input
                    type="text"
                    value={selectedFileForSign.name}
                    disabled
                    style={{ background: '#f6f8fa', cursor: 'not-allowed' }}
                  />
                </div>
                <div className="form-group">
                  <label>Expires In (seconds) <span className="required">*</span></label>
                  <input
                    type="number"
                    min="1"
                    max="604800"
                    value={expiresIn}
                    onChange={(e) => setExpiresIn(e.target.value)}
                    placeholder="3600 (1 hour)"
                  />
                  <small style={{ color: '#8c959f', marginTop: '4px', display: 'block' }}>
                    Range: 1 second to 7 days (604800 seconds)
                  </small>
                </div>
                {signedUrl && (
                  <div className="form-group">
                    <label>Signed URL</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        value={signedUrl}
                        readOnly
                        style={{ flex: 1, fontFamily: 'monospace', fontSize: '12px' }}
                      />
                      <button
                        onClick={() => copyToClipboard(signedUrl)}
                        className="btn btn-primary"
                      >
                        📋 Copy
                      </button>
                    </div>
                  </div>
                )}
                <div className="config-actions">
                  <button
                    onClick={generateSignUrl}
                    disabled={generatingUrl}
                    className="btn btn-primary"
                  >
                    {generatingUrl ? 'Generating...' : '🔗 Generate URL'}
                  </button>
                  <button
                    onClick={() => {
                      setShowSignUrlModal(false);
                      setSignedUrl('');
                      setSelectedFileForSign(null);
                    }}
                    className="btn btn-secondary"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 底部固定面板 - 包含文件详情和上传队列 */}
      <div className={`bottom-panel ${bottomPanelExpanded ? 'expanded' : 'collapsed'}`}>
          <div className="bottom-panel-tabs">
            <button
              className={`bottom-panel-tab ${bottomPanelTab === 'details' ? 'active' : ''}`}
              onClick={() => {
                if (bottomPanelTab === 'details' && bottomPanelExpanded) {
                  setBottomPanelExpanded(false);
                } else {
                  setBottomPanelTab('details');
                  setBottomPanelExpanded(true);
                }
              }}
            >
              📄 File Details
            </button>
            <button
              className={`bottom-panel-tab ${bottomPanelTab === 'upload' ? 'active' : ''}`}
              onClick={() => {
                if (bottomPanelTab === 'upload' && bottomPanelExpanded) {
                  setBottomPanelExpanded(false);
                } else {
                  setBottomPanelTab('upload');
                  setBottomPanelExpanded(true);
                }
              }}
            >
              ⬆️ Upload Queue {selectedFiles.length > 0 && `(${selectedFiles.length})`}
            </button>
          </div>
          {bottomPanelExpanded && (
            <div className="bottom-panel-content">
            {bottomPanelTab === 'details' && (
              <div className="file-details">
                {selectedFileItem ? (
                  <div className="file-details-body">
                      {loadingFileDetails ? (
                        <div className="loading" style={{ padding: '20px', textAlign: 'center' }}>Loading file details...</div>
                      ) : (
                        <>
                          {/* 文件预览 */}
                          <div className="file-details-section">
                            <h4 className="file-details-section-title">Basic Properties</h4>
                            <div className="file-detail-row">
                              <span className="file-detail-label">Key:</span>
                              <span className="file-detail-value">{selectedFileItem.key}</span>
                            </div>
                            <div className="file-detail-row">
                              <span className="file-detail-label">Size:</span>
                              <span className="file-detail-value">{formatSize(selectedFileItem.size)}</span>
                            </div>
                            <div className="file-detail-row">
                              <span className="file-detail-label">Last Modified:</span>
                              <span className="file-detail-value">{formatDate(selectedFileItem.lastModified)}</span>
                            </div>
                            {fileDetails?.contentType && (
                              <div className="file-detail-row">
                                <span className="file-detail-label">Content Type:</span>
                                <span className="file-detail-value">{fileDetails.contentType}</span>
                              </div>
                            )}
                            {fileDetails?.etag && (
                              <div className="file-detail-row">
                                <span className="file-detail-label">ETag:</span>
                                <span className="file-detail-value">{fileDetails.etag}</span>
                              </div>
                            )}
                          </div>

                          {fileDetails && Object.keys(fileDetails.metadata).length > 0 && (
                            <div className="file-details-section">
                              <h4 className="file-details-section-title">Custom Metadata</h4>
                              {Object.entries(fileDetails.metadata).map(([key, value]) => (
                                <div key={key} className="file-detail-row">
                                  <span className="file-detail-label">{key}:</span>
                                  <span className="file-detail-value">{value}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {fileDetails && Object.keys(fileDetails.tags).length > 0 && (
                            <div className="file-details-section">
                              <h4 className="file-details-section-title">Tags</h4>
                              {Object.entries(fileDetails.tags).map(([key, value]) => (
                                <div key={key} className="file-detail-row">
                                  <span className="file-detail-label">{key}:</span>
                                  <span className="file-detail-value">{value}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {fileDetails && Object.keys(fileDetails.metadata).length === 0 && Object.keys(fileDetails.tags).length === 0 && (
                            <div className="empty-message" style={{ padding: '20px', textAlign: 'center', color: '#8c959f' }}>
                              No custom metadata or tags
                            </div>
                          )}
                        </>
                      )}
                  </div>
                ) : (
                  <div className="empty-message" style={{ padding: '40px', textAlign: 'center', color: '#8c959f' }}>
                    No file selected. Click on a file to view its details.
                  </div>
                )}
              </div>
            )}
            {bottomPanelTab === 'upload' && (
              <div className="upload-queue-content">
                {selectedFiles.length === 0 ? (
                  <div className="empty-message" style={{ padding: '40px', textAlign: 'center' }}>
                    No files in upload queue
                  </div>
                ) : (
                  <div className="upload-queue-list">
                    {selectedFiles.map((file) => {
                      const progress = uploadProgress[file.name] || { progress: 0, status: 'pending' as const };
                      return (
                        <div key={file.name} className="upload-queue-item">
                          <div className="upload-item-info">
                            <span className="upload-item-name">{file.name}</span>
                            <span className="upload-item-size">{formatSize(file.size)}</span>
                          </div>
                          <div className="upload-item-actions">
                            {progress.status === 'pending' && (
                              <span className="upload-status pending">Pending</span>
                            )}
                            {progress.status === 'uploading' && (
                              <div className="upload-progress">
                                <div className="upload-progress-bar">
                                  <div 
                                    className="upload-progress-fill" 
                                    style={{ width: `${progress.progress}%` }}
                                  />
                                </div>
                                <span className="upload-status uploading">{progress.progress}%</span>
                              </div>
                            )}
                            {progress.status === 'success' && (
                              <span className="upload-status success">✓ Success</span>
                            )}
                            {progress.status === 'error' && (
                              <span className="upload-status error" title={progress.error}>
                                ✕ Failed
                              </span>
                            )}
                            {!uploading && (
                              <button
                                onClick={() => removeFile(file.name)}
                                className="btn-icon btn-delete"
                                title="Remove"
                              >
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            </div>
          )}
        </div>

      {/* 预览弹窗 */}
      {showPreviewModal && previewFile && (
        <div className="preview-modal">
          <div className="preview-modal-content">
            <div className="preview-modal-header">
              <h3>{previewFile.name}</h3>
              <button
                onClick={() => {
                  setShowPreviewModal(false);
                  setPreviewFile(null);
                  setPreviewUrl(null);
                  setTextContent(null);
                }}
                className="btn-icon btn-close"
                title="Close"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="preview-modal-body">
              {loadingPreview ? (
                <div className="loading" style={{ padding: '40px', textAlign: 'center' }}>Loading preview...</div>
              ) : previewUrl ? (
                (() => {
                  const fileType = getFileType(previewFile.name, fileDetails?.contentType);
                  switch (fileType) {
                    case 'image':
                      return (
                        <div className="preview-image-container">
                          <img src={previewUrl} alt={previewFile.name} className="preview-image" />
                        </div>
                      );
                    case 'text':
                      return (
                        <div className="preview-text-container">
                          <pre className="preview-text">{textContent || 'Loading text content...'}</pre>
                        </div>
                      );
                    case 'pdf':
                      return (
                        <div className="preview-pdf-container">
                          <iframe src={previewUrl} className="preview-pdf" title={previewFile.name} />
                        </div>
                      );
                    case 'video':
                      return (
                        <div className="preview-video-container">
                          <video src={previewUrl} controls className="preview-video" />
                        </div>
                      );
                    case 'audio':
                      return (
                        <div className="preview-audio-container">
                          <audio src={previewUrl} controls className="preview-audio" />
                        </div>
                      );
                    default:
                      return (
                        <div className="empty-message" style={{ padding: '40px', textAlign: 'center', color: '#8c959f' }}>
                          Preview not available for this file type
                        </div>
                      );
                  }
                })()
              ) : (
                <div className="empty-message" style={{ padding: '40px', textAlign: 'center', color: '#8c959f' }}>
                  Failed to load preview
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
