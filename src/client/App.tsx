import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import {
  listBuckets,
  listObjects,
  generateDownloadUrl,
  downloadFileToPath,
  uploadFile,
  deleteObject,
  deleteFolder,
  getObjectInfo,
  createFolder,
  putObjectTags,
  updateObjectMetadata,
  type S3Config,
} from './s3Client';

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
import {
  RefreshCw,
  Eye,
  Download,
  Trash2,
  Link2,
  X,
  Pencil,
  Folder,
  File,
  Package,
  Upload,
  Settings,
  Check,
  AlertCircle,
  Search,
  FolderPlus,
  Plus,
  Save,
  Tag,
  MoreVertical,
} from 'lucide-react';

interface FileItem {
  name: string;
  key: string;
  type: 'file' | 'folder';
  size: number;
  lastModified: Date | null;
}

// S3Config 已从 s3Client 导入

interface Bucket {
  name: string;
  creationDate: Date | null;
}

const STORAGE_KEY = 's3_browser_configs';
const CURRENT_CONFIG_KEY = 's3_browser_current_config_id';

interface S3ConfigWithId extends S3Config {
  id: string;
  name: string;
}

function App() {
  const [items, setItems] = useState<FileItem[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, { progress: number; status: 'pending' | 'uploading' | 'success' | 'error'; error?: string }>>({});
  const [showConfig, setShowConfig] = useState(false);
  const [configs, setConfigs] = useState<S3ConfigWithId[]>([]);
  const [currentConfigId, setCurrentConfigId] = useState<string | null>(null);
  const [config, setConfig] = useState<S3ConfigWithId>({
    id: '',
    name: '',
    endpoint: '',
    accessKeyId: '',
    secretAccessKey: '',
    region: 'us-east-1',
  });
  const [configValid, setConfigValid] = useState(false);
  const [editingConfigId, setEditingConfigId] = useState<string | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [selectedBucket, setSelectedBucket] = useState<string>('');
  const [loadingBuckets, setLoadingBuckets] = useState(false);
  const [bucketSearchQuery, setBucketSearchQuery] = useState<string>('');
  const [continuationToken, setContinuationToken] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showSignUrlModal, setShowSignUrlModal] = useState(false);
  const [selectedFileForSign, setSelectedFileForSign] = useState<FileItem | null>(null);
  const [expiresIn, setExpiresIn] = useState<string>('3600');
  const [signedUrl, setSignedUrl] = useState<string>('');
  const [generatingUrl, setGeneratingUrl] = useState(false);
  const [selectedFileItem, setSelectedFileItem] = useState<FileItem | null>(null);
  const [bottomPanelTab, setBottomPanelTab] = useState<'details' | 'upload' | 'download'>('details');
  const [bottomPanelExpanded, setBottomPanelExpanded] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, { progress: number; status: 'pending' | 'downloading' | 'success' | 'error'; error?: string; fileName: string; fileSize: number }>>({});
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
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [editableTags, setEditableTags] = useState<Array<{ key: string; value: string }>>([]);
  const [savingTags, setSavingTags] = useState(false);
  const [showTagsModal, setShowTagsModal] = useState(false);
  const [tagsModalItem, setTagsModalItem] = useState<FileItem | null>(null);
  const [loadingTagsModal, setLoadingTagsModal] = useState(false);
  const [showMetadataModal, setShowMetadataModal] = useState(false);
  const [metadataModalItem, setMetadataModalItem] = useState<FileItem | null>(null);
  const [loadingMetadataModal, setLoadingMetadataModal] = useState(false);
  const [editableMetadata, setEditableMetadata] = useState<Array<{ key: string; value: string }>>([]);
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [openActionMenu, setOpenActionMenu] = useState<string | null>(null);
  const [actionMenuPos, setActionMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  const handleToggleActionMenu = (itemKey: string, e: React.MouseEvent<HTMLButtonElement>) => {
    if (openActionMenu === itemKey) {
      setOpenActionMenu(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    // 菜单向上弹出，右对齐
    setActionMenuPos({
      top: rect.top - 4,
      left: rect.right - 160, // 160 = min-width of dropdown
    });
    setOpenActionMenu(itemKey);
  };

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
        setOpenActionMenu(null);
      }
    };
    if (openActionMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openActionMenu]);

  // 判断文件是否可预览
  const isPreviewable = (fileName: string, _contentType?: string): boolean => {
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
  const getFileType = (fileName: string, _contentType?: string): 'image' | 'text' | 'pdf' | 'video' | 'audio' | 'unknown' => {
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
    const savedConfigs = localStorage.getItem(STORAGE_KEY);
    const savedCurrentId = localStorage.getItem(CURRENT_CONFIG_KEY);

    if (savedConfigs) {
      try {
        const parsed = JSON.parse(savedConfigs) as S3ConfigWithId[];
        setConfigs(parsed);

        if (parsed.length > 0) {
          const currentId = savedCurrentId || parsed[0].id;
          const currentConfig = parsed.find(c => c.id === currentId) || parsed[0];
          setCurrentConfigId(currentConfig.id);
          setConfig(currentConfig);
          setConfigValid(!!(currentConfig.accessKeyId && currentConfig.secretAccessKey));
          if (currentConfig.accessKeyId && currentConfig.secretAccessKey) {
            // 直接使用配置对象，不依赖状态
            loadBuckets(currentConfig);
          }
        } else {
          setShowConfig(true);
        }
      } catch (e) {
        console.error('Failed to load configs:', e);
        setShowConfig(true);
      }
    } else {
      setShowConfig(true);
    }
  }, []);

  // 加载 bucket 列表
  const loadBuckets = async (configToUse?: S3ConfigWithId) => {
    const configForLoad = configToUse || config;
    if (!configForLoad.accessKeyId || !configForLoad.secretAccessKey) {
      return;
    }
    setLoadingBuckets(true);
    setError(null);
    try {
      // 转换为 S3Config 类型（去掉 id 和 name）
      const s3Config: S3Config = {
        endpoint: configForLoad.endpoint,
        accessKeyId: configForLoad.accessKeyId,
        secretAccessKey: configForLoad.secretAccessKey,
        region: configForLoad.region,
      };
      const bucketsList = await listBuckets(s3Config);
      setBuckets(bucketsList);
    } catch (err: any) {
      console.error('Failed to load buckets:', err);
      setError(err.message || 'Failed to load buckets');
      setBuckets([]);
    } finally {
      setLoadingBuckets(false);
    }
  };

  // 注意：不再自动加载 bucket 列表，只有在用户保存配置或切换配置时才加载

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
    const downloadId = `${file.key}-${Date.now()}`;

    // 检查是否在 Electron 环境
    if (window.electron) {
      // Electron 环境：先弹出保存对话框
      const result = await window.electron.showSaveDialog({
        defaultPath: file.name,
      });

      if (result.canceled || !result.filePath) {
        return; // 用户取消了
      }

      const filePath = result.filePath;

      // 添加到下载队列
      setDownloadProgress(prev => ({
        ...prev,
        [downloadId]: { progress: 0, status: 'downloading', fileName: file.name, fileSize: file.size }
      }));

      // 展开底部面板并切换到下载标签
      setBottomPanelExpanded(true);
      setBottomPanelTab('download');

      try {
        // 下载到指定路径
        await downloadFileToPath(
          config,
          selectedBucket,
          file.key,
          file.size,
          filePath,
          (progress) => {
            setDownloadProgress(prev => ({
              ...prev,
              [downloadId]: { ...prev[downloadId], progress, status: 'downloading' }
            }));
          }
        );

        // 更新状态为成功
        setDownloadProgress(prev => ({
          ...prev,
          [downloadId]: { ...prev[downloadId], progress: 100, status: 'success' }
        }));
      } catch (err: any) {
        // 更新状态为错误
        setDownloadProgress(prev => ({
          ...prev,
          [downloadId]: { ...prev[downloadId], progress: 0, status: 'error', error: err.message || 'Failed to download' }
        }));
      }
    } else {
      // 浏览器环境：使用传统方式下载
      setDownloadProgress(prev => ({
        ...prev,
        [downloadId]: { progress: 0, status: 'downloading', fileName: file.name, fileSize: file.size }
      }));

      setBottomPanelExpanded(true);
      setBottomPanelTab('download');

      try {
        setDownloadProgress(prev => ({
          ...prev,
          [downloadId]: { ...prev[downloadId], progress: 50, status: 'downloading' }
        }));

        const url = await generateDownloadUrl(config, selectedBucket, file.key, 3600, true);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // 更新状态为成功
        setDownloadProgress(prev => ({
          ...prev,
          [downloadId]: { ...prev[downloadId], progress: 100, status: 'success' }
        }));
      } catch (err: any) {
        setDownloadProgress(prev => ({
          ...prev,
          [downloadId]: { ...prev[downloadId], progress: 0, status: 'error', error: err.message || 'Failed to download' }
        }));
      }
    }
  };

  // 清除下载队列中的已完成/失败项
  const clearCompletedDownloads = () => {
    setDownloadProgress(prev => {
      const newProgress: typeof prev = {};
      Object.entries(prev).forEach(([key, value]) => {
        if (value.status === 'downloading') {
          newProgress[key] = value;
        }
      });
      return newProgress;
    });
  };

  // 移除单个下载项
  const removeDownloadItem = (downloadId: string) => {
    setDownloadProgress(prev => {
      const newProgress = { ...prev };
      delete newProgress[downloadId];
      return newProgress;
    });
  };

  const handleDelete = async (item: FileItem) => {
    if (item.type === 'folder') {
      if (!confirm(`Are you sure you want to delete folder "${item.name}"? The folder must be empty.`)) {
        return;
      }
      try {
        await deleteFolder(config, selectedBucket, item.key);
        loadFiles(currentPath);
      } catch (err: any) {
        alert(err.message || 'Failed to delete folder');
      }
    } else {
      if (!confirm(`Are you sure you want to delete ${item.name}?`)) {
        return;
      }
      try {
        await deleteObject(config, selectedBucket, item.key);
        loadFiles(currentPath);
      } catch (err: any) {
        alert(err.message || 'Failed to delete file');
      }
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      alert('Please enter a folder name');
      return;
    }

    // 验证文件夹名称
    const folderName = newFolderName.trim();
    if (folderName.includes('/')) {
      alert('Folder name cannot contain "/"');
      return;
    }

    setCreatingFolder(true);
    try {
      const folderPath = currentPath ? `${currentPath}${folderName}` : folderName;
      await createFolder(config, selectedBucket, folderPath);
      setShowCreateFolderModal(false);
      setNewFolderName('');
      loadFiles(currentPath);
    } catch (err: any) {
      alert(err.message || 'Failed to create folder');
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleOpenTagsModal = async (item: FileItem) => {
    setTagsModalItem(item);
    setShowTagsModal(true);
    setLoadingTagsModal(true);
    setEditableTags([]);
    try {
      const info = await getObjectInfo(config, selectedBucket, item.key);
      const tags = Object.entries(info.tags || {}).map(([key, value]) => ({ key, value }));
      if (tags.length === 0) {
        tags.push({ key: '', value: '' });
      }
      setEditableTags(tags);
    } catch (err: any) {
      console.error('Failed to load tags:', err);
      setEditableTags([{ key: '', value: '' }]);
    } finally {
      setLoadingTagsModal(false);
    }
  };

  const handleSaveTagsModal = async () => {
    if (!tagsModalItem) return;

    const validTags = editableTags.filter(tag => tag.key.trim() !== '');
    const keys = validTags.map(tag => tag.key.trim());
    const uniqueKeys = new Set(keys);
    if (uniqueKeys.size !== keys.length) {
      alert('Duplicate tag keys are not allowed.');
      return;
    }

    const tagsRecord: Record<string, string> = {};
    validTags.forEach(tag => {
      tagsRecord[tag.key.trim()] = tag.value;
    });

    setSavingTags(true);
    try {
      await putObjectTags(config, selectedBucket, tagsModalItem.key, tagsRecord);
      // 如果当前详情面板选中的也是这个文件，同步更新
      if (selectedFileItem?.key === tagsModalItem.key) {
        setFileDetails(prev => prev ? { ...prev, tags: tagsRecord } : prev);
      }
      setShowTagsModal(false);
      setTagsModalItem(null);
      setEditableTags([]);
    } catch (err: any) {
      alert(err.message || 'Failed to save tags');
    } finally {
      setSavingTags(false);
    }
  };

  const handleAddTag = () => {
    setEditableTags(prev => [...prev, { key: '', value: '' }]);
  };

  const handleRemoveTag = (index: number) => {
    setEditableTags(prev => prev.filter((_, i) => i !== index));
  };

  const handleTagChange = (index: number, field: 'key' | 'value', val: string) => {
    setEditableTags(prev => prev.map((tag, i) => i === index ? { ...tag, [field]: val } : tag));
  };

  const handleOpenMetadataModal = async (item: FileItem) => {
    setMetadataModalItem(item);
    setShowMetadataModal(true);
    setLoadingMetadataModal(true);
    setEditableMetadata([]);
    try {
      const info = await getObjectInfo(config, selectedBucket, item.key);
      const meta = Object.entries(info.metadata || {}).map(([key, value]) => ({ key, value }));
      if (meta.length === 0) {
        meta.push({ key: '', value: '' });
      }
      setEditableMetadata(meta);
    } catch (err: any) {
      console.error('Failed to load metadata:', err);
      setEditableMetadata([{ key: '', value: '' }]);
    } finally {
      setLoadingMetadataModal(false);
    }
  };

  const handleSaveMetadataModal = async () => {
    if (!metadataModalItem) return;

    const validMeta = editableMetadata.filter(m => m.key.trim() !== '');
    const keys = validMeta.map(m => m.key.trim());
    const uniqueKeys = new Set(keys);
    if (uniqueKeys.size !== keys.length) {
      alert('Duplicate metadata keys are not allowed.');
      return;
    }

    const metaRecord: Record<string, string> = {};
    validMeta.forEach(m => {
      metaRecord[m.key.trim()] = m.value;
    });

    setSavingMetadata(true);
    try {
      await updateObjectMetadata(config, selectedBucket, metadataModalItem.key, metaRecord);
      // 如果当前详情面板选中的也是这个文件，同步更新
      if (selectedFileItem?.key === metadataModalItem.key) {
        setFileDetails(prev => prev ? { ...prev, metadata: metaRecord } : prev);
      }
      setShowMetadataModal(false);
      setMetadataModalItem(null);
      setEditableMetadata([]);
    } catch (err: any) {
      alert(err.message || 'Failed to save metadata');
    } finally {
      setSavingMetadata(false);
    }
  };

  const handleAddMetadata = () => {
    setEditableMetadata(prev => [...prev, { key: '', value: '' }]);
  };

  const handleRemoveMetadata = (index: number) => {
    setEditableMetadata(prev => prev.filter((_, i) => i !== index));
  };

  const handleMetadataChange = (index: number, field: 'key' | 'value', val: string) => {
    setEditableMetadata(prev => prev.map((m, i) => i === index ? { ...m, [field]: val } : m));
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

  const handleConfigChange = (field: keyof S3ConfigWithId, value: string) => {
    const newConfig = { ...config, [field]: value };
    setConfig(newConfig);
    if (field === 'accessKeyId' || field === 'secretAccessKey') {
      setConfigValid(!!(newConfig.accessKeyId && newConfig.secretAccessKey));
    }
  };

  const handleSaveConfig = async () => {
    if (!config.name || !config.name.trim()) {
      alert('Please enter a configuration name');
      return;
    }
    if (!config.accessKeyId || !config.secretAccessKey) {
      alert('Please fill in all required fields');
      return;
    }

    const trimmedName = config.name.trim();

    // 检查配置名是否重复
    const nameExists = configs.some(c => {
      // 如果是编辑模式，排除当前编辑的配置
      if (editingConfigId && c.id === editingConfigId) {
        return false;
      }
      return c.name.trim().toLowerCase() === trimmedName.toLowerCase();
    });

    if (nameExists) {
      alert('Configuration name already exists. Please use a different name.');
      return;
    }

    const configToSave: S3ConfigWithId = {
      ...config,
      id: config.id || `config_${Date.now()}`,
      name: trimmedName,
    };

    let updatedConfigs: S3ConfigWithId[];
    if (editingConfigId && configs.find(c => c.id === editingConfigId)) {
      // 更新现有配置
      updatedConfigs = configs.map(c => c.id === editingConfigId ? configToSave : c);
    } else {
      // 添加新配置
      updatedConfigs = [...configs, configToSave];
    }

    // 测试配置是否有效：尝试加载 bucket 列表
    try {
      const s3Config: S3Config = {
        endpoint: configToSave.endpoint,
        accessKeyId: configToSave.accessKeyId,
        secretAccessKey: configToSave.secretAccessKey,
        region: configToSave.region,
      };
      await listBuckets(s3Config);

      // 配置有效，保存并应用
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedConfigs));
      setConfigs(updatedConfigs);
      setCurrentConfigId(configToSave.id);
      localStorage.setItem(CURRENT_CONFIG_KEY, configToSave.id);
      setConfig(configToSave);
      setConfigValid(true);
      setError(null); // 清除之前的错误
      setShowConfig(false);
      setEditingConfigId(null);
      // 清空当前选中的bucket和文件列表
      setSelectedBucket('');
      setItems([]);
      setCurrentPath('');
      // 直接使用新配置加载bucket列表
      await loadBuckets(configToSave);
    } catch (err: any) {
      // 配置无效，显示错误提示
      const errorMessage = err.message || 'Failed to connect to S3. Please check your configuration.';
      alert(`Configuration Error: ${errorMessage}\n\nPlease verify:\n- Endpoint URL is correct\n- Access Key ID is valid\n- Secret Access Key is correct\n- Network connection is available`);
      console.error('S3 connection test failed:', err);
    }
  };

  const handleSelectConfig = async (configId: string) => {
    const selectedConfig = configs.find(c => c.id === configId);
    if (selectedConfig) {
      setCurrentConfigId(configId);
      setConfig(selectedConfig);
      const isValid = !!(selectedConfig.accessKeyId && selectedConfig.secretAccessKey);
      setConfigValid(isValid);
      localStorage.setItem(CURRENT_CONFIG_KEY, configId);
      setEditingConfigId(null);
      // 清空当前选中的bucket和文件列表
      setSelectedBucket('');
      setItems([]);
      setCurrentPath('');
      if (isValid) {
        // 直接使用新配置加载bucket列表，不依赖状态更新
        await loadBuckets(selectedConfig);
      } else {
        setBuckets([]);
      }
    }
  };

  const handleAddNewConfig = () => {
    setConfig({
      id: '',
      name: '',
      endpoint: '',
      accessKeyId: '',
      secretAccessKey: '',
      region: 'us-east-1',
    });
    setConfigValid(false);
    setEditingConfigId(null);
  };

  const handleEditConfig = (configId: string) => {
    const configToEdit = configs.find(c => c.id === configId);
    if (configToEdit) {
      setConfig(configToEdit);
      setEditingConfigId(configId);
      // 编辑配置时只更新 UI 状态，不触发自动加载
      setConfigValid(!!(configToEdit.accessKeyId && configToEdit.secretAccessKey));
    }
  };

  const handleDeleteConfig = (configId: string) => {
    if (!confirm('Are you sure you want to delete this configuration?')) {
      return;
    }
    const updatedConfigs = configs.filter(c => c.id !== configId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedConfigs));
    setConfigs(updatedConfigs);

    if (currentConfigId === configId) {
      if (updatedConfigs.length > 0) {
        const newCurrent = updatedConfigs[0];
        setCurrentConfigId(newCurrent.id);
        setConfig(newCurrent);
        const isValid = !!(newCurrent.accessKeyId && newCurrent.secretAccessKey);
        setConfigValid(isValid);
        localStorage.setItem(CURRENT_CONFIG_KEY, newCurrent.id);
        // 清空当前选中的bucket和文件列表
        setSelectedBucket('');
        setItems([]);
        setCurrentPath('');
        // 直接使用新配置加载bucket列表
        if (isValid) {
          loadBuckets(newCurrent);
        } else {
          setBuckets([]);
        }
      } else {
        setCurrentConfigId(null);
        setConfig({
          id: '',
          name: '',
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
        localStorage.removeItem(CURRENT_CONFIG_KEY);
      }
    }
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

  const formatDate = (date: Date | string | null): string => {
    if (!date) return '-';
    if (date instanceof Date) return date.toLocaleString();
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
      <header className={`app-header${(window as any).electron?.platform === 'darwin' ? ' macos' : ''}`}>
        <h1><Package size={24} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '8px' }} /> S3 Browser</h1>
        <button onClick={() => setShowConfig(true)} className="btn btn-config">
          <Settings size={16} style={{ marginRight: '4px', display: 'inline', verticalAlign: 'middle' }} /> Configure
        </button>
      </header>

      {showConfig && (
        <div
          className="config-modal"
          onClick={(e) => {
            // 点击背景层时关闭弹窗
            if (e.target === e.currentTarget) {
              setShowConfig(false);
              setEditingConfigId(null);
              if (currentConfigId) {
                const currentConfig = configs.find(c => c.id === currentConfigId);
                if (currentConfig) {
                  setConfig(currentConfig);
                }
              }
            }
          }}
        >
          <div
            className="config-content"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2>S3 Configuration</h2>

            {/* 配置列表 */}
            {configs.length > 0 && (
              <div className="config-list-section">
                <label style={{ marginBottom: '8px', display: 'block', fontWeight: 500 }}>Saved Configurations</label>
                <div className="config-list">
                  {configs.map((cfg) => (
                    <div key={cfg.id} className={`config-list-item ${currentConfigId === cfg.id ? 'active' : ''}`}>
                      <div
                        className="config-list-item-name"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectConfig(cfg.id);
                        }}
                        style={{ flex: 1, cursor: 'pointer' }}
                      >
                        {cfg.name} {currentConfigId === cfg.id && '(Current)'}
                      </div>
                      <div className="config-list-item-actions">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditConfig(cfg.id);
                          }}
                          className="btn-icon btn-edit"
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteConfig(cfg.id);
                          }}
                          className="btn-icon btn-delete"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAddNewConfig();
                  }}
                  className="btn btn-secondary"
                  style={{ marginTop: '12px', width: '100%' }}
                >
                  ➕ Add New Configuration
                </button>
              </div>
            )}

            <div className="config-form" style={{ marginTop: configs.length > 0 ? '24px' : '0' }}>
              <div className="form-group">
                <label>Configuration Name <span className="required">*</span></label>
                <input
                  type="text"
                  placeholder="e.g., Production, Development, MinIO Local"
                  value={config.name}
                  onChange={(e) => handleConfigChange('name', e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>Endpoint (可选，留空使用 AWS S3)</label>
                <input
                  type="text"
                  placeholder="https://s3.amazonaws.com"
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
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSaveConfig();
                  }}
                  className="btn btn-primary"
                >
                  💾 {editingConfigId ? 'Update' : 'Save'} & Connect
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowConfig(false);
                    setEditingConfigId(null);
                    if (currentConfigId) {
                      const currentConfig = configs.find(c => c.id === currentConfigId);
                      if (currentConfig) {
                        setConfig(currentConfig);
                      }
                    }
                  }}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
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
              <button onClick={() => loadBuckets()} className="btn-icon" title="Refresh buckets">
                <RefreshCw size={16} />
              </button>
            </div>
            {/* Bucket 搜索框 */}
            <div className="bucket-search">
              <Search size={14} className="bucket-search-icon" />
              <input
                type="text"
                placeholder="Search buckets..."
                value={bucketSearchQuery}
                onChange={(e) => setBucketSearchQuery(e.target.value)}
                className="bucket-search-input"
              />
              {bucketSearchQuery && (
                <button
                  onClick={() => setBucketSearchQuery('')}
                  className="bucket-search-clear"
                  title="Clear search"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <div className="sidebar-content">
              {loadingBuckets ? (
                <div className="loading">Loading buckets...</div>
              ) : error ? (
                <div className="error-message" style={{ padding: '16px', margin: '8px', background: '#fff5f5', border: '1px solid #ffd8d8', borderRadius: '6px', color: '#cf222e' }}>
                  <div style={{ fontWeight: 600, marginBottom: '8px' }}>❌ Connection Error</div>
                  <div style={{ fontSize: '13px', lineHeight: '1.5' }}>{error}</div>
                  <button
                    onClick={() => {
                      setError(null);
                      loadBuckets();
                    }}
                    className="btn btn-sm"
                    style={{ marginTop: '12px', width: '100%' }}
                  >
                    <RefreshCw size={14} style={{ marginRight: '4px', display: 'inline', verticalAlign: 'middle' }} /> Retry
                  </button>
                </div>
              ) : buckets.length === 0 ? (
                <div className="empty-message">No buckets found</div>
              ) : (
                <div className="bucket-list">
                  {buckets
                    .filter((bucket) =>
                      bucket.name.toLowerCase().includes(bucketSearchQuery.toLowerCase())
                    )
                    .map((bucket) => (
                      <button
                        key={bucket.name}
                        onClick={() => handleBucketSelect(bucket.name)}
                        className={`bucket-item ${selectedBucket === bucket.name ? 'active' : ''}`}
                      >
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
                  {buckets.filter((bucket) =>
                    bucket.name.toLowerCase().includes(bucketSearchQuery.toLowerCase())
                  ).length === 0 && (
                    <div className="empty-message">No matching buckets</div>
                  )}
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
                        <Folder size={16} style={{ marginRight: '4px', display: 'inline', verticalAlign: 'middle' }} /> Select Files
                      </button>
                      {selectedFiles.length > 0 && (
                        <>
                          <button
                            onClick={handleUpload}
                            disabled={uploading}
                            className="btn btn-upload"
                          >
                            {uploading ? 'Uploading...' : <><Upload size={16} style={{ marginRight: '4px', display: 'inline', verticalAlign: 'middle' }} /> Upload {selectedFiles.length} File{selectedFiles.length > 1 ? 's' : ''}</>}
                          </button>
                          <button
                            onClick={clearSelectedFiles}
                            className="btn btn-secondary"
                            disabled={uploading}
                          >
                            <X size={14} style={{ marginRight: '4px', display: 'inline', verticalAlign: 'middle' }} /> Clear
                          </button>
                        </>
                      )}
                    </div>
                    <div className="toolbar-actions">
                      <button
                        onClick={() => setShowCreateFolderModal(true)}
                        className="btn btn-secondary"
                        title="Create Folder"
                      >
                        <FolderPlus size={16} style={{ marginRight: '4px', display: 'inline', verticalAlign: 'middle' }} /> New Folder
                      </button>
                      <button onClick={() => loadFiles(currentPath)} className="btn-icon" title="Refresh">
                        <RefreshCw size={16} />
                      </button>
                    </div>
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
                                      <Folder size={16} style={{ marginRight: '6px', flexShrink: 0 }} /> {item.name}
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
                                        padding: '4px 8px',
                                        cursor: 'pointer',
                                        color: selectedFileItem?.key === item.key ? '#0969da' : 'inherit',
                                        fontWeight: selectedFileItem?.key === item.key ? 600 : 'normal',
                                        textAlign: 'left',
                                        width: '100%'
                                      }}
                                    >
                                      <File size={16} style={{ marginRight: '6px', flexShrink: 0 }} /> {item.name}
                                    </button>
                                  )}
                                </td>
                                <td>{item.type === 'file' ? formatSize(item.size) : '-'}</td>
                                <td>{formatDate(item.lastModified)}</td>
                                <td>
                                  <div className="action-buttons">
                                    {item.type === 'file' && (
                                      <>
                                        <button
                                          onClick={() => isPreviewable(item.name) && handlePreview(item)}
                                          className={`btn-icon btn-preview ${!isPreviewable(item.name) ? 'disabled' : ''}`}
                                          title={isPreviewable(item.name) ? 'Preview' : 'Not previewable'}
                                          disabled={!isPreviewable(item.name)}
                                        >
                                          <Eye size={16} />
                                        </button>
                                        <button
                                          onClick={() => handleDownload(item)}
                                          className="btn-icon btn-download"
                                          title="Download"
                                        >
                                          <Download size={16} />
                                        </button>
                                        <button
                                          onClick={() => handleGenerateSignUrl(item)}
                                          className="btn-icon btn-sign-url"
                                          title="Generate Signed URL"
                                        >
                                          <Link2 size={16} />
                                        </button>
                                      </>
                                    )}
                                    <button
                                      onClick={() => handleDelete(item)}
                                      className="btn-icon btn-delete"
                                      title={item.type === 'folder' ? 'Delete Folder' : 'Delete'}
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                    {item.type === 'file' && (
                                      <div className="action-menu-wrapper">
                                        <button
                                          onClick={(e) => handleToggleActionMenu(item.key, e)}
                                          className="btn-icon btn-more"
                                          title="More Actions"
                                        >
                                          <MoreVertical size={16} />
                                        </button>
                                      </div>
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

      {/* 创建目录对话框 */}
      {showCreateFolderModal && (
        <div className="config-modal">
          <div className="config-content" style={{ maxWidth: '400px' }}>
            <h2>Create New Folder</h2>
            <div className="config-form">
              <div className="form-group">
                <label>Folder Name <span className="required">*</span></label>
                <input
                  type="text"
                  placeholder="Enter folder name"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !creatingFolder) {
                      handleCreateFolder();
                    }
                  }}
                  autoFocus
                />
                {currentPath && (
                  <small style={{ color: '#8c959f', marginTop: '4px', display: 'block' }}>
                    Will be created in: {currentPath}
                  </small>
                )}
              </div>
              <div className="config-actions">
                <button
                  onClick={handleCreateFolder}
                  disabled={creatingFolder || !newFolderName.trim()}
                  className="btn btn-primary"
                >
                  {creatingFolder ? 'Creating...' : <><FolderPlus size={16} style={{ marginRight: '4px', display: 'inline', verticalAlign: 'middle' }} /> Create</>}
                </button>
                <button
                  onClick={() => {
                    setShowCreateFolderModal(false);
                    setNewFolderName('');
                  }}
                  className="btn btn-secondary"
                  disabled={creatingFolder}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tags 编辑弹窗 */}
      {showTagsModal && tagsModalItem && (
        <div className="config-modal">
          <div className="config-content" style={{ maxWidth: '560px' }}>
            <h2>
              <Tag size={18} style={{ marginRight: '8px', display: 'inline', verticalAlign: 'middle' }} />
              Edit Tags - {tagsModalItem.name}
            </h2>
            {loadingTagsModal ? (
              <div className="loading" style={{ padding: '20px', textAlign: 'center' }}>Loading tags...</div>
            ) : (
              <div className="config-form">
                <div className="tags-editor">
                  <div className="tag-edit-row" style={{ marginBottom: '4px' }}>
                    <span style={{ flex: 1, fontWeight: 600, fontSize: '12px', color: '#57606a', textTransform: 'uppercase' }}>Key</span>
                    <span style={{ flex: 1, fontWeight: 600, fontSize: '12px', color: '#57606a', textTransform: 'uppercase' }}>Value</span>
                    <span style={{ width: '32px' }}></span>
                  </div>
                  {editableTags.map((tag, index) => (
                    <div key={index} className="tag-edit-row">
                      <input
                        type="text"
                        className="tag-input"
                        placeholder="Key"
                        value={tag.key}
                        onChange={(e) => handleTagChange(index, 'key', e.target.value)}
                        disabled={savingTags}
                      />
                      <input
                        type="text"
                        className="tag-input"
                        placeholder="Value"
                        value={tag.value}
                        onChange={(e) => handleTagChange(index, 'value', e.target.value)}
                        disabled={savingTags}
                      />
                      <button
                        onClick={() => handleRemoveTag(index)}
                        className="btn-icon btn-delete"
                        title="Remove Tag"
                        disabled={savingTags}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={handleAddTag}
                    className="btn btn-add-tag"
                    disabled={savingTags}
                    style={{ marginTop: '4px' }}
                  >
                    <Plus size={14} style={{ marginRight: '4px', display: 'inline', verticalAlign: 'middle' }} />
                    Add Tag
                  </button>
                </div>
                <div className="config-actions" style={{ marginTop: '16px' }}>
                  <button
                    onClick={handleSaveTagsModal}
                    disabled={savingTags}
                    className="btn btn-primary"
                  >
                    {savingTags ? 'Saving...' : <><Save size={16} style={{ marginRight: '4px', display: 'inline', verticalAlign: 'middle' }} /> Save</>}
                  </button>
                  <button
                    onClick={() => {
                      setShowTagsModal(false);
                      setTagsModalItem(null);
                      setEditableTags([]);
                    }}
                    className="btn btn-secondary"
                    disabled={savingTags}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 更多操作下拉菜单（fixed 定位，避免被 overflow 裁剪） */}
      {openActionMenu && (
        <div
          ref={actionMenuRef}
          className="action-dropdown"
          style={{ top: actionMenuPos.top, left: actionMenuPos.left, transform: 'translateY(-100%)' }}
        >
          <button
            className="action-dropdown-item"
            onClick={() => {
              const item = items.find(i => i.key === openActionMenu);
              setOpenActionMenu(null);
              if (item) handleOpenTagsModal(item);
            }}
          >
            <Tag size={14} /> Edit Tags
          </button>
          <button
            className="action-dropdown-item"
            onClick={() => {
              const item = items.find(i => i.key === openActionMenu);
              setOpenActionMenu(null);
              if (item) handleOpenMetadataModal(item);
            }}
          >
            <Pencil size={14} /> Edit Metadata
          </button>
        </div>
      )}

      {/* Metadata 编辑弹窗 */}
      {showMetadataModal && metadataModalItem && (
        <div className="config-modal">
          <div className="config-content" style={{ maxWidth: '560px' }}>
            <h2>
              <Pencil size={18} style={{ marginRight: '8px', display: 'inline', verticalAlign: 'middle' }} />
              Edit Metadata - {metadataModalItem.name}
            </h2>
            {loadingMetadataModal ? (
              <div className="loading" style={{ padding: '20px', textAlign: 'center' }}>Loading metadata...</div>
            ) : (
              <div className="config-form">
                <div className="tags-editor">
                  <div className="tag-edit-row" style={{ marginBottom: '4px' }}>
                    <span style={{ flex: 1, fontWeight: 600, fontSize: '12px', color: '#57606a', textTransform: 'uppercase' }}>Key</span>
                    <span style={{ flex: 1, fontWeight: 600, fontSize: '12px', color: '#57606a', textTransform: 'uppercase' }}>Value</span>
                    <span style={{ width: '32px' }}></span>
                  </div>
                  {editableMetadata.map((meta, index) => (
                    <div key={index} className="tag-edit-row">
                      <input
                        type="text"
                        className="tag-input"
                        placeholder="Key"
                        value={meta.key}
                        onChange={(e) => handleMetadataChange(index, 'key', e.target.value)}
                        disabled={savingMetadata}
                      />
                      <input
                        type="text"
                        className="tag-input"
                        placeholder="Value"
                        value={meta.value}
                        onChange={(e) => handleMetadataChange(index, 'value', e.target.value)}
                        disabled={savingMetadata}
                      />
                      <button
                        onClick={() => handleRemoveMetadata(index)}
                        className="btn-icon btn-delete"
                        title="Remove"
                        disabled={savingMetadata}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={handleAddMetadata}
                    className="btn btn-add-tag"
                    disabled={savingMetadata}
                    style={{ marginTop: '4px' }}
                  >
                    <Plus size={14} style={{ marginRight: '4px', display: 'inline', verticalAlign: 'middle' }} />
                    Add Metadata
                  </button>
                </div>
                <div className="config-actions" style={{ marginTop: '16px' }}>
                  <button
                    onClick={handleSaveMetadataModal}
                    disabled={savingMetadata}
                    className="btn btn-primary"
                  >
                    {savingMetadata ? 'Saving...' : <><Save size={16} style={{ marginRight: '4px', display: 'inline', verticalAlign: 'middle' }} /> Save</>}
                  </button>
                  <button
                    onClick={() => {
                      setShowMetadataModal(false);
                      setMetadataModalItem(null);
                      setEditableMetadata([]);
                    }}
                    className="btn btn-secondary"
                    disabled={savingMetadata}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 底部固定面板 - 包含文件详情和上传队列 */}
      {configValid && (
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
              <File size={16} style={{ marginRight: '4px', display: 'inline', verticalAlign: 'middle' }} /> File Details
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
              <Upload size={16} style={{ marginRight: '4px', display: 'inline', verticalAlign: 'middle' }} /> Upload Queue {selectedFiles.length > 0 && `(${selectedFiles.length})`}
            </button>
            <button
              className={`bottom-panel-tab ${bottomPanelTab === 'download' ? 'active' : ''}`}
              onClick={() => {
                if (bottomPanelTab === 'download' && bottomPanelExpanded) {
                  setBottomPanelExpanded(false);
                } else {
                  setBottomPanelTab('download');
                  setBottomPanelExpanded(true);
                }
              }}
            >
              <Download size={16} style={{ marginRight: '4px', display: 'inline', verticalAlign: 'middle' }} /> Download Queue {Object.keys(downloadProgress).length > 0 && `(${Object.keys(downloadProgress).length})`}
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
                              No custom metadata
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
                  <div className="empty-message" style={{ padding: '40px', textAlign: 'left' }}>
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
                              <span className="upload-status success"><Check size={14} style={{ marginRight: '4px', display: 'inline', verticalAlign: 'middle' }} /> Success</span>
                            )}
                            {progress.status === 'error' && (
                              <span className="upload-status error" title={progress.error}>
                                <AlertCircle size={14} style={{ marginRight: '4px', display: 'inline', verticalAlign: 'middle' }} /> Failed
                              </span>
                            )}
                            {!uploading && (
                              <button
                                onClick={() => removeFile(file.name)}
                                className="btn-icon btn-delete"
                                title="Remove"
                              >
                                <X size={14} />
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
            {bottomPanelTab === 'download' && (
              <div className="download-queue-content">
                {Object.keys(downloadProgress).length === 0 ? (
                  <div className="empty-message" style={{ padding: '40px', textAlign: 'left' }}>
                    No files in download queue
                  </div>
                ) : (
                  <>
                    <div className="download-queue-header">
                      <button
                        onClick={clearCompletedDownloads}
                        className="btn btn-secondary btn-sm"
                        style={{ marginBottom: '12px' }}
                      >
                        <X size={14} style={{ marginRight: '4px', display: 'inline', verticalAlign: 'middle' }} /> Clear Completed
                      </button>
                    </div>
                    <div className="download-queue-list">
                      {Object.entries(downloadProgress).map(([downloadId, progress]) => (
                        <div key={downloadId} className="upload-queue-item">
                          <div className="upload-item-info">
                            <span className="upload-item-name">{progress.fileName}</span>
                            <span className="upload-item-size">{formatSize(progress.fileSize)}</span>
                          </div>
                          <div className="upload-item-actions">
                            {progress.status === 'downloading' && (
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
                              <span className="upload-status success"><Check size={14} style={{ marginRight: '4px', display: 'inline', verticalAlign: 'middle' }} /> Success</span>
                            )}
                            {progress.status === 'error' && (
                              <span className="upload-status error" title={progress.error}>
                                <AlertCircle size={14} style={{ marginRight: '4px', display: 'inline', verticalAlign: 'middle' }} /> Failed
                              </span>
                            )}
                            {progress.status !== 'downloading' && (
                              <button
                                onClick={() => removeDownloadItem(downloadId)}
                                className="btn-icon btn-delete"
                                title="Remove"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            </div>
          )}
        </div>
      )}

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
                <X size={16} />
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
