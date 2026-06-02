import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Layout, Button, Input, message, Modal, List, Tag, Space, Upload, Progress, Tooltip,
  Select, Switch, Divider, Tabs,
} from 'antd';
import {
  PlusOutlined, SendOutlined, InboxOutlined, MessageOutlined,
  DeleteOutlined, PaperClipOutlined, AudioOutlined, StopOutlined,
  SoundOutlined, ReloadOutlined, CloudSyncOutlined, AudioMutedOutlined,
  PauseCircleOutlined, HeartOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { Popconfirm } from 'antd';
import { API_BASE, getWsBase } from './config';
import BabyTripPanel from './components/BabyTripPanel';

const { Sider, Content } = Layout;
const { TextArea } = Input;
const { TabPane } = Tabs;

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

interface MessageItem {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

const USER_ID = 'demo-user';

function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const [knowledgeList, setKnowledgeList] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [youdaoModalVisible, setYoudaoModalVisible] = useState(false);
  const [youdaoCookie, setYoudaoCookie] = useState('');
  const [youdaoCstk, setYoudaoCstk] = useState('');
  const [youdaoSyncing, setYoudaoSyncing] = useState(false);
  const [youdaoConnected, setYoudaoConnected] = useState(false);
  const [youdaoNoteCount, setYoudaoNoteCount] = useState(0);
  const [youdaoSyncJobId, setYoudaoSyncJobId] = useState<string | null>(null);
  const [youdaoCronEnabled, setYoudaoCronEnabled] = useState(true);
  const [youdaoCronExpr, setYoudaoCronExpr] = useState('0 */1 * * *');
  const [youdaoCronPreset, setYoudaoCronPreset] = useState<string>('1h');
  const [youdaoLastSyncAt, setYoudaoLastSyncAt] = useState<string | null>(null);
  const [youdaoScheduleSaving, setYoudaoScheduleSaving] = useState(false);
  const [mainTab, setMainTab] = useState('chat');

  const YOUDAO_CRON_PRESETS = [
    { label: '每 1 小时', value: '0 */1 * * *', key: '1h' },
    { label: '每 2 小时', value: '0 */2 * * *', key: '2h' },
    { label: '每 6 小时', value: '0 */6 * * *', key: '6h' },
    { label: '每 12 小时', value: '0 */12 * * *', key: '12h' },
    { label: '每天 8:00', value: '0 8 * * *', key: 'daily8' },
    { label: '每天 0:00', value: '0 0 * * *', key: 'daily0' },
    { label: '自定义', value: '', key: 'custom' },
  ] as const;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Voice state
  const [isRecording, setIsRecording] = useState(false);
  const [isPlayingTts, setIsPlayingTts] = useState(false);
  const isMutedRef = useRef(false);
  const [isMuted, setIsMuted] = useState(false);
  const [activeTtsText, setActiveTtsText] = useState<string>('');
  const [voiceWs, setVoiceWs] = useState<WebSocket | null>(null);
  const [voiceType, setVoiceType] = useState(101001);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const ttsQueueRef = useRef<string[]>([]);
  const ttsProcessingRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsCancelRef = useRef(false);
  const audioQueueRef = useRef<string[]>([]);
  const audioPlayingRef = useRef(false);
  const lastTtsTextRef = useRef<string>('');
  const currentTtsTextRef = useRef<string>('');
  const skipMuteOnceRef = useRef(false);

  const voiceOptions = [
    { label: '智云(女)', value: 101001 },
    { label: '智云(男)', value: 101002 },
    { label: '智美(女)', value: 101003 },
    { label: '智言(男)', value: 101004 },
    { label: '智橙(男)', value: 101005 },
    { label: '智莉(女)', value: 101006 },
  ];

  useEffect(() => {
    loadConversations();
    loadKnowledgeList();
    connectVoiceWs();
  }, []);

  useEffect(() => {
    if (currentConversation) {
      loadConversation(currentConversation);
    }
  }, [currentConversation]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const connectVoiceWs = () => {
    const ws = new WebSocket(`${getWsBase()}/ws/tts`);
    ws.onopen = () => console.log('Voice WS connected');
    ws.onclose = () => {
      console.log('Voice WS disconnected, reconnecting...');
      setTimeout(connectVoiceWs, 3000);
    };
    ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'tts_chunk' && data.audio) {
            playAudioBase64Ref.current(data.audio);
          } else if (data.type === 'tts_complete') {
            skipMuteOnceRef.current = false;
            setIsPlayingTts(false);
            ttsProcessingRef.current = false;
          } else if (data.type === 'tts_error') {
            console.error('TTS error:', data.message);
            ttsProcessingRef.current = false;
            setIsPlayingTts(false);
            setActiveTtsText('');
          } else if (data.type === 'tts_start') {
            audioQueueRef.current = [];
            audioPlayingRef.current = false;
          }
        } catch (e) {
          // Binary data or parsing error
        }
      };
    setVoiceWs(ws);
  };

  /**
   * 顺序播放音频队列，每个片段播放完毕后自动播放下一个
   */
  const processAudioQueueRef = useRef<() => void>(() => {});
  const playAudioBase64Ref = useRef<(base64: string) => void>(() => {});

  const processAudioQueue = useCallback(() => {
    if (ttsCancelRef.current) {
      audioPlayingRef.current = false;
      audioQueueRef.current = [];
      return;
    }

    if (audioQueueRef.current.length === 0) {
      audioPlayingRef.current = false;
      currentAudioRef.current = null;
      return;
    }

    audioPlayingRef.current = true;
    const base64 = audioQueueRef.current.shift()!;

    // 如果已有音频在播放，先停止
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }

    try {
      const audio = new Audio();
      audio.src = `data:audio/mp3;base64,${base64}`;
      audio.muted = isMutedRef.current && !skipMuteOnceRef.current;
      audio.volume = audio.muted ? 0 : 1;
      currentAudioRef.current = audio;

      const onEnded = () => {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        currentAudioRef.current = null;
        processAudioQueueRef.current();
      };

      const onError = () => {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        console.error('Audio decode error');
        currentAudioRef.current = null;
        processAudioQueueRef.current();
      };

      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);

      audio.play().catch(e => {
        console.error('Audio play error:', e);
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        currentAudioRef.current = null;
        processAudioQueueRef.current();
      });
    } catch (e) {
      console.error('Audio setup error:', e);
      currentAudioRef.current = null;
      processAudioQueueRef.current();
    }
  }, []);

  processAudioQueueRef.current = processAudioQueue;

  const playAudioBase64 = useCallback((base64: string) => {
    if (ttsCancelRef.current) return;
    audioQueueRef.current.push(base64);
    if (!audioPlayingRef.current) {
      processAudioQueueRef.current();
    }
  }, []);

  playAudioBase64Ref.current = playAudioBase64;

  const stopTts = useCallback(() => {
    ttsCancelRef.current = true;
    skipMuteOnceRef.current = false;
    ttsQueueRef.current = [];
    ttsProcessingRef.current = false;
    setIsPlayingTts(false);
    setActiveTtsText('');
    audioQueueRef.current = [];
    audioPlayingRef.current = false;

    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }

    setTimeout(() => {
      ttsCancelRef.current = false;
    }, 100);
  }, []);

  const sendTtsToWs = useCallback((text: string) => {
    if (!voiceWs || voiceWs.readyState !== WebSocket.OPEN) {
      console.warn('Voice WS not ready');
      return;
    }
    ttsCancelRef.current = false;
    setIsPlayingTts(true);
    setActiveTtsText(text);
    currentTtsTextRef.current = text;
    voiceWs.send(JSON.stringify({ type: 'tts', text, voiceType }));
  }, [voiceWs, voiceType]);

  const replayTts = useCallback((text: string) => {
    if (!voiceWs || voiceWs.readyState !== WebSocket.OPEN) return;
    // 先停止当前播放
    ttsCancelRef.current = true;
    audioQueueRef.current = [];
    audioPlayingRef.current = false;
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }

    // 延迟后重新发送
    setTimeout(() => {
      ttsCancelRef.current = false;
      skipMuteOnceRef.current = true;
      setIsPlayingTts(true);
      setActiveTtsText(text);
      currentTtsTextRef.current = text;
      voiceWs!.send(JSON.stringify({ type: 'tts', text, voiceType }));
    }, 200);
  }, [voiceWs, voiceType]);

  const toggleMute = useCallback(() => {
    const newMuted = !isMutedRef.current;
    isMutedRef.current = newMuted;
    setIsMuted(newMuted);
    skipMuteOnceRef.current = false;
    if (currentAudioRef.current) {
      currentAudioRef.current.muted = newMuted;
      currentAudioRef.current.volume = newMuted ? 0 : 1;
    }
  }, []);

  const handleReplay = useCallback((text: string) => {
    // 从头开始重新播放
    stopTts();
    setTimeout(() => {
      skipMuteOnceRef.current = true;
      sendTtsToWs(text);
    }, 300);
  }, [stopTts, sendTtsToWs]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        // 转换为 PCM 16kHz 单声道 16bit 格式
        const pcmBase64 = await convertToPcm16k(blob);
        await transcribeAudio(pcmBase64);
      };

      mediaRecorder.start();
      setIsRecording(true);
      message.info('录音中，请说话...');
    } catch (error) {
      message.error('无法访问麦克风');
    }
  };

  /**
   * 使用 AudioContext 将音频转换为 PCM 16kHz 单声道 16bit
   * 参考Python实现：先解码音频，再重采样到16kHz，提取Int16 PCM数据
   */
  const convertToPcm16k = async (blob: Blob): Promise<string> => {
    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    // 创建 OfflineAudioContext 进行重采样到 16kHz
    const targetSampleRate = 16000;
    const offlineCtx = new OfflineAudioContext(
      1, // mono
      Math.ceil(audioBuffer.duration * targetSampleRate),
      targetSampleRate
    );
    
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start();
    
    const resampledBuffer = await offlineCtx.startRendering();
    
    // 提取 PCM 数据 (16-bit little-endian)
    const channelData = resampledBuffer.getChannelData(0);
    const pcmData = new Int16Array(channelData.length);
    for (let i = 0; i < channelData.length; i++) {
      // Convert float [-1, 1] to int16 [-32768, 32767]
      const s = Math.max(-1, Math.min(1, channelData[i]));
      pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    
    // 转换为 base64 (不带 WAV header，纯 PCM 数据)
    const bytes = new Uint8Array(pcmData.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      message.info('录音已停止，正在识别...');
    }
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.readAsDataURL(blob);
    });
  };

  const transcribeAudio = async (base64: string) => {
    try {
      const res = await axios.post(`${API_BASE}/voice/transcribe`, {
        audio: base64,
      }, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.data.text) {
        setInputText(res.data.text);
        message.success('语音识别成功');
      }
    } catch (error) {
      message.error('语音识别失败');
      console.error(error);
    }
  };

  const loadConversations = async () => {
    try {
      const res = await axios.get(`${API_BASE}/conversations`, {
        headers: { 'x-user-id': USER_ID },
      });
      setConversations(res.data);
      // 默认选中第一个会话
      if (res.data.length > 0 && !currentConversation) {
        setCurrentConversation(res.data[0].id);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const loadConversation = async (id: string) => {
    try {
      const res = await axios.get(`${API_BASE}/conversations/${id}`);
      setMessages(res.data.messages || []);
    } catch (error) {
      console.error(error);
    }
  };

  const loadKnowledgeList = async () => {
    try {
      const res = await axios.get(`${API_BASE}/knowledge`, {
        headers: { 'x-user-id': USER_ID },
      });
      setKnowledgeList(res.data);
    } catch (error) {
      console.error(error);
    }
  };

  const createConversation = async () => {
    try {
      const res = await axios.post(
        `${API_BASE}/conversations`,
        { title: `新对话 ${new Date().toLocaleString()}` },
        { headers: { 'x-user-id': USER_ID } },
      );
      await loadConversations();
      setCurrentConversation(res.data.id);
      setMessages([]);
    } catch (error) {
      message.error('创建对话失败');
    }
  };

  const sendMessage = async () => {
    if (!inputText.trim()) return;

    let convId = currentConversation;
    if (!convId) {
      try {
        const res = await axios.post(
          `${API_BASE}/conversations`,
          { title: inputText.slice(0, 20) + (inputText.length > 20 ? '...' : '') },
          { headers: { 'x-user-id': USER_ID } },
        );
        convId = res.data.id;
        setCurrentConversation(convId);
        await loadConversations();
      } catch (error) {
        message.error('创建对话失败');
        return;
      }
    }

    const userMessage = inputText;
    setInputText('');
    
    const userMsgId = Date.now().toString();
    setMessages(prev => [...prev, { id: userMsgId, role: 'user', content: userMessage, createdAt: new Date().toISOString() }]);
    
    const assistantMsgId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, { id: assistantMsgId, role: 'assistant', content: '', createdAt: new Date().toISOString() }]);
    
    setLoading(true);

    let fullContent = '';

    try {
      const response = await fetch(`${API_BASE}/ai/chat/${convId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': USER_ID,
        },
        body: JSON.stringify({ message: userMessage }),
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            if (data.text) {
              fullContent += data.text;
              setMessages(prev =>
                prev.map(msg =>
                  msg.id === assistantMsgId ? { ...msg, content: fullContent } : msg
                )
              );
            }
            if (data.done) {
              setLoading(false);
              // Send TTS after response complete
              if (voiceWs && voiceWs.readyState === WebSocket.OPEN) {
                currentTtsTextRef.current = fullContent;
                sendTtsToWs(fullContent);
              }
              break;
            }
          }
        }
      }
    } catch (error) {
      message.error('发送消息失败');
      setLoading(false);
    }
  };

  const handleBatchUpload = async (fileList: any[]) => {
    if (fileList.length === 0) return;
    setUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    fileList.forEach((file: any) => {
      formData.append('files', file.originFileObj || file);
    });

    try {
      const res = await axios.post(`${API_BASE}/files/upload/batch`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'x-user-id': USER_ID,
        },
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            setUploadProgress(Math.round((progressEvent.loaded * 100) / progressEvent.total));
          }
        },
      });
      const successCount = res.data.results.filter((r: any) => r.success).length;
      message.success(`上传完成: ${successCount}/${res.data.total} 成功`);
      await loadKnowledgeList();
    } catch (error) {
      message.error('批量上传失败');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
    return false;
  };

  const handleFileUpload = async (file: any) => {
    const formData = new FormData();
    formData.append('file', file);
    setUploading(true);

    try {
      await axios.post(`${API_BASE}/files/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'x-user-id': USER_ID,
        },
      });
      message.success('文件上传成功');
      await loadKnowledgeList();
    } catch (error) {
      message.error('文件上传失败');
    } finally {
      setUploading(false);
    }
    return false;
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleFileUpload(file);
    e.target.value = '';
  };

  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await axios.delete(`${API_BASE}/conversations/${id}`);
      if (currentConversation === id) {
        setCurrentConversation(null);
        setMessages([]);
      }
      await loadConversations();
      message.success('对话已删除');
    } catch (error) {
      message.error('删除失败');
    }
  };

  const deleteKnowledgeDocument = async (id: string) => {
    try {
      await axios.delete(`${API_BASE}/knowledge/${id}`, {
        headers: { 'x-user-id': USER_ID },
      });
      message.success('文档已删除');
      await loadKnowledgeList();
    } catch (error) {
      message.error('删除文档失败');
    }
  };

  const checkYoudaoConnection = async () => {
    try {
      const res = await axios.get(`${API_BASE}/sources/youdao/notes`, {
        headers: { 'x-user-id': USER_ID },
      });
      setYoudaoConnected(res.data.connected);
      setYoudaoNoteCount(res.data.total ?? 0);
    } catch (error: any) {
      setYoudaoConnected(false);
      setYoudaoNoteCount(0);
      const msg = error.response?.data?.message;
      if (msg) message.error(msg);
    }
  };

  const resolveCronPreset = (cronExpr: string) => {
    const found = YOUDAO_CRON_PRESETS.find((p) => p.value === cronExpr);
    return found?.key ?? 'custom';
  };

  const loadYoudaoSyncConfig = async () => {
    try {
      const res = await axios.get(`${API_BASE}/sources/youdao/sync-config`, {
        headers: { 'x-user-id': USER_ID },
      });
      const job = res.data.job;
      if (job) {
        setYoudaoSyncJobId(job.id);
        setYoudaoCronEnabled(job.enabled);
        const expr = job.cronExpr || res.data.defaultCronExpr || '0 */1 * * *';
        setYoudaoCronExpr(expr);
        setYoudaoCronPreset(resolveCronPreset(expr));
        setYoudaoLastSyncAt(job.lastSyncAt ?? null);
      } else {
        setYoudaoSyncJobId(null);
        setYoudaoCronEnabled(true);
        const expr = res.data.defaultCronExpr || '0 */1 * * *';
        setYoudaoCronExpr(expr);
        setYoudaoCronPreset(resolveCronPreset(expr));
        setYoudaoLastSyncAt(null);
      }
    } catch {
      /* 未连接时忽略 */
    }
  };

  const openYoudaoModal = async () => {
    setYoudaoModalVisible(true);
    await Promise.all([checkYoudaoConnection(), loadYoudaoSyncConfig()]);
  };

  const handleCronPresetChange = (key: string) => {
    setYoudaoCronPreset(key);
    const preset = YOUDAO_CRON_PRESETS.find((p) => p.key === key);
    if (preset && preset.key !== 'custom') {
      setYoudaoCronExpr(preset.value);
    }
  };

  const saveYoudaoSchedule = async () => {
    if (!youdaoSyncJobId) {
      message.warning('请先保存连接，再配置定时同步');
      return;
    }
    const expr = youdaoCronExpr.trim();
    if (!expr.split(/\s+/).length || expr.split(/\s+/).length < 5) {
      message.warning('请输入有效的 cron 表达式（5 段）');
      return;
    }
    setYoudaoScheduleSaving(true);
    try {
      const res = await axios.patch(
        `${API_BASE}/sources/sync/jobs/${youdaoSyncJobId}`,
        { enabled: youdaoCronEnabled, cronExpr: expr },
        { headers: { 'x-user-id': USER_ID } },
      );
      setYoudaoCronExpr(res.data.cronExpr);
      setYoudaoCronEnabled(res.data.enabled);
      setYoudaoCronPreset(resolveCronPreset(res.data.cronExpr));
      message.success('定时同步已保存');
    } catch (error: any) {
      message.error(error.response?.data?.message || '保存定时配置失败');
    } finally {
      setYoudaoScheduleSaving(false);
    }
  };

  const saveYoudaoCredentials = async () => {
    if (!youdaoCookie.trim() || !youdaoCstk.trim()) {
      message.warning('请填写 Cookie 和 cstk');
      return;
    }
    try {
      await axios.post(
        `${API_BASE}/sources/youdao/credentials`,
        { cookie: youdaoCookie.trim(), cstk: youdaoCstk.trim() },
        { headers: { 'x-user-id': USER_ID } },
      );
      message.success('有道云笔记已连接');
      await Promise.all([checkYoudaoConnection(), loadYoudaoSyncConfig()]);
    } catch (error: any) {
      message.error(error.response?.data?.message || '保存凭据失败');
    }
  };

  const syncYoudaoNotes = async () => {
    setYoudaoSyncing(true);
    try {
      const res = await axios.post(
        `${API_BASE}/sources/youdao/sync`,
        { syncAll: true, batchSize: 3, batchDelayMs: 800 },
        { headers: { 'x-user-id': USER_ID }, timeout: 600000 },
      );
      const errPreview = res.data.errors?.length
        ? res.data.errors.slice(0, 3).map((e: { title: string; error: string }) => `${e.title}: ${e.error}`).join('；')
        : '';
      if (res.data.succeeded > 0) {
        message.success(
          `同步完成：成功 ${res.data.succeeded}/${res.data.total} 篇` +
            (res.data.failed > 0 ? `，失败 ${res.data.failed} 篇` : ''),
        );
      } else {
        message.error(
          `同步失败：成功 0/${res.data.total} 篇` + (errPreview ? `。${errPreview}` : ''),
          8,
        );
      }
      await loadKnowledgeList();
      await Promise.all([checkYoudaoConnection(), loadYoudaoSyncConfig()]);
    } catch (error: any) {
      message.error(error.response?.data?.message || '同步失败');
    } finally {
      setYoudaoSyncing(false);
    }
  };

  const sourceTagColor = (provider?: string) => {
    if (provider === 'youdao') return 'green';
    if (provider === 'feishu') return 'blue';
    return 'default';
  };

  const sourceLabel = (provider?: string) => {
    if (provider === 'youdao') return '有道';
    if (provider === 'feishu') return '飞书';
    return '本地上传';
  };

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider width={300} style={{ background: '#fff', borderRight: '1px solid #f0f0f0' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid #f0f0f0' }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={createConversation} block>
            新建对话
          </Button>
        </div>
        <div style={{ overflowY: 'auto', height: 'calc(100vh - 80px)' }}>
          <List
            dataSource={conversations}
            renderItem={item => (
              <List.Item
                style={{
                  cursor: 'pointer',
                  padding: '12px 16px',
                  background: currentConversation === item.id ? '#e6f7ff' : 'transparent',
                  transition: 'background 0.3s',
                }}
                onClick={() => setCurrentConversation(item.id)}
                actions={[
                  <DeleteOutlined onClick={(e) => deleteConversation(item.id, e)} style={{ color: '#ff4d4f' }} />,
                ]}
              >
                <Space>
                  <MessageOutlined />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                    {item.title}
                  </span>
                </Space>
              </List.Item>
            )}
          />
        </div>
      </Sider>
      <Layout>
        <Tabs
          activeKey={mainTab}
          onChange={setMainTab}
          tabBarStyle={{ margin: 0, padding: '0 16px', background: '#fff' }}
          style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
        >
          <TabPane
            tab={
              <span>
                <MessageOutlined /> AI 对话
              </span>
            }
            key="chat"
          >
            <Content style={{ padding: 24, background: '#f5f5f5', display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, overflowY: 'auto', marginBottom: 16 }}>
                {messages.map(msg => (
                  <div
                    key={msg.id}
                    style={{
                      padding: '12px 16px',
                      marginBottom: 8,
                      background: msg.role === 'user' ? '#e6f7ff' : '#fff',
                      borderRadius: 8,
                      maxWidth: '80%',
                      marginLeft: msg.role === 'user' ? 'auto' : 0,
                      marginRight: msg.role === 'user' ? 0 : 'auto',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontWeight: 500, color: msg.role === 'user' ? '#1890ff' : '#52c41a' }}>
                        {msg.role === 'user' ? '我' : '助手'}
                      </span>
                      {msg.role === 'assistant' && msg.content && (
                        <Space size={4}>
                          <Tooltip title={isMuted ? '取消静音' : '静音'}>
                            <Button
                              type="text"
                              size="small"
                              icon={isMuted ? <SoundOutlined /> : <AudioMutedOutlined />}
                              onClick={toggleMute}
                              style={{
                                padding: 0,
                                color: isMuted ? '#ff9800' : '#8c8c8c',
                              }}
                            />
                          </Tooltip>
                          {activeTtsText === msg.content && isPlayingTts && (
                            <Tooltip title="停止播放">
                              <Button
                                type="text"
                                size="small"
                                icon={<StopOutlined />}
                                onClick={stopTts}
                                style={{ padding: 0, color: '#ff4d4f' }}
                              />
                            </Tooltip>
                          )}
                          <Tooltip title="重新播放">
                            <Button
                              type="text"
                              size="small"
                              icon={<ReloadOutlined />}
                              onClick={() => handleReplay(msg.content)}
                              style={{ padding: 0, color: '#999' }}
                            />
                          </Tooltip>
                        </Space>
                      )}
                    </div>
                    {msg.role === 'assistant' ? (
                      msg.content ? (
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      ) : (
                        <span style={{ color: '#999' }}>思考中...</span>
                      )
                    ) : (
                      msg.content
                    )}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
              
              <div style={{ background: '#fff', padding: '12px 16px', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Button 
                    icon={<PaperClipOutlined />} 
                    onClick={() => fileInputRef.current?.click()}
                    loading={uploading}
                    size="small"
                  >
                    上传文档
                  </Button>
                  <Button 
                    icon={<SoundOutlined />} 
                    onClick={() => setUploadModalVisible(true)}
                    size="small"
                  >
                    查看知识库
                  </Button>
                  <Button
                    icon={<CloudSyncOutlined />}
                    onClick={openYoudaoModal}
                    size="small"
                  >
                    有道云笔记
                  </Button>
                  <Button
                    icon={isRecording ? <StopOutlined /> : <AudioOutlined />}
                    type={isRecording ? 'primary' : 'default'}
                    danger={isRecording}
                    onClick={isRecording ? stopRecording : startRecording}
                    size="small"
                  >
                    {isRecording ? '停止录音' : '语音输入'}
                  </Button>
                  <Select
                    value={voiceType}
                    onChange={setVoiceType}
                    options={voiceOptions}
                    size="small"
                    style={{ width: 120 }}
                  />
                  {uploadProgress > 0 && <Progress percent={uploadProgress} size="small" style={{ width: 120 }} />}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.gif,.webp"
                    multiple
                    onChange={async (e) => {
                      const files = Array.from(e.target.files || []);
                      if (files.length > 1) {
                        await handleBatchUpload(files.map(f => ({ originFileObj: f })));
                      } else if (files.length === 1) {
                        await handleFileUpload(files[0]);
                      }
                      e.target.value = '';
                    }}
                    style={{ display: 'none' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <TextArea
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    onPressEnter={e => !e.shiftKey && (e.preventDefault(), sendMessage())}
                    placeholder="输入消息，按 Enter 发送，Shift + Enter 换行"
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    style={{ flex: 1 }}
                  />
                  <Button type="primary" icon={<SendOutlined />} onClick={sendMessage} loading={loading}>
                    发送
                  </Button>
                </div>
              </div>
            </Content>
          </TabPane>
          <TabPane
            tab={
              <span>
                <HeartOutlined /> 溜娃助手
              </span>
            }
            key="babytrip"
          >
            <BabyTripPanel />
          </TabPane>
        </Tabs>
      </Layout>

      <Modal
        title="知识库文档列表"
        open={uploadModalVisible}
        onCancel={() => setUploadModalVisible(false)}
        footer={null}
        width={700}
      >
        <List
          dataSource={knowledgeList}
          renderItem={item => (
            <List.Item
              actions={[
                <Popconfirm
                  title="确定要删除此文档吗？"
                  onConfirm={() => deleteKnowledgeDocument(item.id)}
                  okText="确定"
                  cancelText="取消"
                >
                  <DeleteOutlined style={{ color: '#ff4d4f', cursor: 'pointer' }} />
                </Popconfirm>,
              ]}
            >
              <Tag color={sourceTagColor(item.sourceProvider)}>{sourceLabel(item.sourceProvider)}</Tag>
              <Tag color="blue">{item.fileType}</Tag>
              <span style={{ marginLeft: 8, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.filename}
              </span>
              <span style={{ marginLeft: 8, color: '#999', fontSize: 12, flexShrink: 0 }}>
                {new Date(item.createdAt).toLocaleString()}
              </span>
            </List.Item>
          )}
        />
      </Modal>

      <Modal
        title="有道云笔记同步"
        open={youdaoModalVisible}
        onCancel={() => setYoudaoModalVisible(false)}
        footer={null}
        width={560}
      >
        <p style={{ color: '#666', fontSize: 13, marginBottom: 16 }}>
          在浏览器打开{' '}
          <a href="https://note.youdao.com" target="_blank" rel="noreferrer">
            note.youdao.com
          </a>
          ，登录后按 F12 → Network，任选请求复制 Cookie，并从 URL 或请求参数中找到 cstk。
        </p>
        {youdaoConnected && (
          <p style={{ marginBottom: 12 }}>
            已连接，检测到约 <strong>{youdaoNoteCount}</strong> 篇笔记可同步。
          </p>
        )}
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4 }}>Cookie</div>
          <TextArea
            value={youdaoCookie}
            onChange={e => setYoudaoCookie(e.target.value)}
            placeholder="YNOTE_SESS=...; ..."
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 4 }}>cstk</div>
          <Input
            value={youdaoCstk}
            onChange={e => setYoudaoCstk(e.target.value)}
            placeholder="从请求参数 keyfrom=web&cstk= 后复制"
          />
        </div>
        <Divider style={{ margin: '16px 0' }}>定时自动同步</Divider>
        <div
          style={{
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>启用定时同步</span>
          <Switch
            checked={youdaoCronEnabled}
            onChange={setYoudaoCronEnabled}
            disabled={!youdaoSyncJobId}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4 }}>同步频率</div>
          <Select
            style={{ width: '100%' }}
            value={youdaoCronPreset}
            onChange={handleCronPresetChange}
            disabled={!youdaoSyncJobId}
            options={YOUDAO_CRON_PRESETS.map((p) => ({
              label: p.label,
              value: p.key,
            }))}
          />
        </div>
        {youdaoCronPreset === 'custom' && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 4 }}>Cron 表达式</div>
            <Input
              value={youdaoCronExpr}
              onChange={(e) => setYoudaoCronExpr(e.target.value)}
              placeholder="0 */1 * * *"
              disabled={!youdaoSyncJobId}
            />
          </div>
        )}
        {youdaoCronPreset !== 'custom' && (
          <p style={{ color: '#999', fontSize: 12, marginBottom: 12 }}>
            当前规则：<code>{youdaoCronExpr}</code>
          </p>
        )}
        {youdaoLastSyncAt && (
          <p style={{ color: '#999', fontSize: 12, marginBottom: 12 }}>
            上次同步：{new Date(youdaoLastSyncAt).toLocaleString()}
          </p>
        )}
        <Button
          block
          onClick={saveYoudaoSchedule}
          loading={youdaoScheduleSaving}
          disabled={!youdaoSyncJobId}
          style={{ marginBottom: 16 }}
        >
          保存定时设置
        </Button>

        <Space wrap>
          <Button type="primary" onClick={saveYoudaoCredentials}>
            保存连接
          </Button>
          <Button
            type="primary"
            icon={<CloudSyncOutlined />}
            loading={youdaoSyncing}
            onClick={syncYoudaoNotes}
            disabled={!youdaoConnected}
          >
            立即同步全部笔记
          </Button>
        </Space>
        <p style={{ color: '#999', fontSize: 12, marginTop: 16 }}>
          凭据加密保存在服务端；定时任务由 BullMQ 调度（需 Redis 与后端常驻运行）。
        </p>
      </Modal>
    </Layout>
  );
}

export default App;
