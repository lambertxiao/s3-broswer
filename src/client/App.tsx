import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

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

interface S3Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
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
      const response = await fetch('/api/list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prefix: path,
          bucket: bucketToUse,
          config,
          continuationToken: append ? continuationToken : undefined,
          maxKeys: 100,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to load files');
      }
      const data: ListResponse = await response.json();
      
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
  const loadMoreFiles = useCallback(() => {
    if (loadingMore || !hasMore || !continuationToken || loading || !configValid || !selectedBucket) {
      return;
    }
    
    setLoadingMore(true);
    setError(null);
    
    fetch('/api/list', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prefix: currentPath,
        bucket: selectedBucket,
        config,
        continuationToken: continuationToken,
        maxKeys: 100,
      }),
    })
      .then(response => {
        if (!response.ok) {
          return response.json().then(errorData => {
            throw new Error(errorData.error || 'Failed to load files');
          });
        }
        return response.json();
      })
      .then((data: ListResponse) => {
        // 追加数据时去重，避免重复的 key
        setItems(prev => {
          const existingKeys = new Set(prev.map(item => item.key));
          const newItems = [...data.folders, ...data.files].filter(item => !existingKeys.has(item.key));
          return [...prev, ...newItems];
        });
        setContinuationToken(data.continuationToken || null);
        setHasMore(data.isTruncated || false);
      })
      .catch((err: any) => {
        setError(err.message || 'Failed to load files');
      })
      .finally(() => {
        setLoadingMore(false);
      });
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
      const response = await fetch('/api/buckets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ config }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to load buckets');
      }
      const data = await response.json();
      setBuckets(data.buckets || []);
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
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key: file.key,
          bucket: selectedBucket,
          config,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to generate download URL');
      }
      const data = await response.json();
      window.open(data.url, '_blank');
    } catch (err: any) {
      alert(err.message || 'Failed to download file');
    }
  };

  const handleDelete = async (item: FileItem) => {
    if (!confirm(`Are you sure you want to delete ${item.name}?`)) {
      return;
    }
    try {
      const response = await fetch('/api/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key: item.key,
          bucket: selectedBucket,
          config,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to delete');
      }
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
      const response = await fetch('/api/sign-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key: selectedFileForSign.key,
          bucket: selectedBucket,
          config,
          expiresIn: expires,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to generate signed URL');
      }
      const data = await response.json();
      setSignedUrl(data.url);
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
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      alert('Please select a file');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('prefix', currentPath);
      formData.append('bucket', selectedBucket);
      formData.append('config', JSON.stringify(config));

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to upload file');
      }

      setSelectedFile(null);
      const fileInput = document.getElementById('file-input') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      loadFiles(currentPath);
    } catch (err: any) {
      alert(err.message || 'Failed to upload file');
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
                  <div className="selected-bucket-info">
                    <strong>Bucket:</strong> {selectedBucket}
                  </div>
                  <div className="toolbar">
                    <div className="upload-section">
                      <input
                        id="file-input"
                        type="file"
                        onChange={handleFileSelect}
                        style={{ display: 'none' }}
                      />
                      <button
                        onClick={() => document.getElementById('file-input')?.click()}
                        className="btn btn-primary"
                      >
                        📁 Select File
                      </button>
                      {selectedFile && (
                        <>
                          <span className="selected-file">{selectedFile.name}</span>
                          <button
                            onClick={handleUpload}
                            disabled={uploading}
                            className="btn btn-upload"
                          >
                            {uploading ? 'Uploading...' : '⬆️ Upload'}
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
                                    <span className="file-name">📄 {item.name}</span>
                                  )}
                                </td>
                                <td>{item.type === 'file' ? formatSize(item.size) : '-'}</td>
                                <td>{formatDate(item.lastModified)}</td>
                                <td>
                                  <div className="action-buttons">
                                    {item.type === 'file' && (
                                      <>
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
    </div>
  );
}

export default App;
