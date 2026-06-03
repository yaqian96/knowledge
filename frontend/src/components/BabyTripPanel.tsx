import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Button, Input, message, Tabs, List, Card, Tag, Space, Divider,
  Collapse, Spin, Empty, Statistic, Timeline, Descriptions,
  Progress, Badge, Modal,
} from 'antd';
import {
  SendOutlined, EnvironmentOutlined, CloudOutlined, ThunderboltOutlined,
  MailOutlined, ClockCircleOutlined, PlayCircleOutlined,
  CheckCircleOutlined, CloseCircleOutlined, SyncOutlined,
  GlobalOutlined, HomeOutlined, DollarOutlined,
  FileTextOutlined, EyeOutlined, CarOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import { executeBabyTrip, getTrace, getTasks, getVisitedSpots, markVisited, type BabyTripRequest, type TraceRecord } from '../services/babyTrip.api';

const { TextArea } = Input;
const { Panel } = Collapse;

const USER_ID = 'demo-user';

interface WeatherInfo {
  date: string;
  temp: number;
  weather: string;
  humidity: number;
  windSpeed: number;
  airQuality?: string;
  suitableForKids: boolean;
  tips: string;
}

interface SpotInfo {
  name: string;
  address: string;
  lat: number;
  lng: number;
  distance: number;
  category: string;
  rating: number;
  ticketPrice: string;
  ageRange: string;
}

export default function BabyTripPanel() {
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [trace, setTrace] = useState<TraceRecord | null>(null);
  const [activeTab, setActiveTab] = useState('panel');
  const [tasks, setTasks] = useState<any[]>([]);
  const [visitedSpots, setVisitedSpots] = useState<any[]>([]);
  const [emailConfigVisible, setEmailConfigVisible] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [childAge, setChildAge] = useState(5);
  const [currentResult, setCurrentResult] = useState<any>(null);
  const [selectedTaskTrace, setSelectedTaskTrace] = useState<TraceRecord | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number; city?: string } | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);

  const traceEndRef = useRef<HTMLDivElement>(null);
  const sseRef = useRef<EventSource | null>(null);

  useEffect(() => {
    loadTasks();
    loadVisitedSpots();
    detectLocation();
  }, []);

  const detectLocation = () => {
    if (!navigator.geolocation) return;
    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setUserLocation({ lat: latitude, lng: longitude });
        setLocationLoading(false);
        // Try to get city name via reverse geocoding (using AMAP or simple approach)
        fetchCityName(latitude, longitude);
      },
      () => {
        setLocationLoading(false);
        // Fallback to default
      },
      { timeout: 5000 },
    );
  };

  const fetchCityName = async (lat: number, lng: number) => {
    try {
      const res = await fetch(`https://restapi.amap.com/v3/geocode/regeo?key=${import.meta.env.VITE_AMAP_KEY || ''}&location=${lng},${lat}`);
      const data = await res.json();
      if (data.status === '1' && data.regeocode) {
        setUserLocation(prev => prev ? { ...prev, city: data.regeocode.addressComponent.city || data.regeocode.addressComponent.province } : null);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    traceEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [trace?.toolCalls?.length, trace?.reasoningSteps?.length]);

  const loadTasks = async () => {
    try {
      const res = await getTasks(USER_ID);
      setTasks(res.data);
    } catch (err) {
      console.error('加载任务列表失败', err);
    }
  };

  const loadVisitedSpots = async () => {
    try {
      const res = await getVisitedSpots(USER_ID);
      setVisitedSpots(res.data);
    } catch (err) {
      console.error('加载游玩记录失败', err);
    }
  };

  const handleExecute = async () => {
    if (!inputText.trim()) return;
    setLoading(true);
    setCurrentResult(null);

    const request: BabyTripRequest = {
      userId: USER_ID,
      message: inputText,
      childAge,
      emailTo: emailTo || undefined,
      lat: userLocation?.lat,
      lng: userLocation?.lng,
    };

    try {
      const res = await executeBabyTrip(request);
      if (res.data.success) {
        setCurrentResult(res.data.data);
        message.success(res.data.message);
        if (res.data.traceId) {
          await loadTrace(res.data.traceId);
          startSSE(res.data.traceId);
        }
        loadTasks();
      } else {
        message.error(res.data.message);
      }
    } catch (err: any) {
      message.error(err.response?.data?.message || '执行失败');
    } finally {
      setLoading(false);
    }
  };

  const loadTrace = async (taskId: string) => {
    try {
      const res = await getTrace(taskId, USER_ID);
      setTrace(res.data);
    } catch (err) {
      console.error('加载追踪记录失败', err);
    }
  };

  const startSSE = (taskId: string) => {
    if (sseRef.current) sseRef.current.close();
    const es = new EventSource(`${window.location.origin}/baby-trip/trace/stream/${taskId}`);
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'trace_update' && data.data) {
          setTrace(data.data);
        }
        if (data.type === 'complete') {
          es.close();
        }
      } catch (err) {
        // ignore
      }
    };
    es.onerror = () => {
      es.close();
    };
    sseRef.current = es;
  };

  useEffect(() => {
    return () => {
      if (sseRef.current) sseRef.current.close();
    };
  }, []);

  const handleMarkVisited = async (spotName: string) => {
    Modal.confirm({
      title: '标记为已游玩',
      content: '确认已将此景点标记为已游玩？',
      onOk: async () => {
        await markVisited(USER_ID, spotName);
        message.success('已标记');
        loadVisitedSpots();
      },
    });
  };

  const handleViewTask = async (task: any) => {
    setSelectedTaskTrace(null);
    try {
      const res = await getTrace(task.id, USER_ID);
      if (res.data) {
        setSelectedTaskTrace(res.data);
        setActiveTab('history');
      }
    } catch (err) {
      message.error('加载任务详情失败');
    }
  };

  const openNavigation = (spot: SpotInfo) => {
    const destLat = spot.lat || 0;
    const destLng = spot.lng || 0;
    const originLat = userLocation?.lat || '';
    const originLng = userLocation?.lng || '';
    const amapUrl = `https://uri.amap.com/navigation?to=${destLng},${destLat},${encodeURIComponent(spot.name)}&from=${originLng},${originLat}&mode=car`;
    window.open(amapUrl, '_blank');
  };

  const getWeatherIcon = (weather: string) => {
    if (!weather) return '🌤️';
    if (weather.includes('晴')) return '☀️';
    if (weather.includes('多云')) return '🌥️';
    if (weather.includes('阴')) return '☁️';
    if (weather.includes('雨')) return '🌧️';
    if (weather.includes('雪')) return '❄️';
    return '🌤️';
  };

  const getStepIcon = (type: string) => {
    switch (type) {
      case 'intent_analysis': return <EyeOutlined />;
      case 'task_decomposition': return <FileTextOutlined />;
      case 'tool_selection': return <ThunderboltOutlined />;
      case 'result_synthesis': return <CheckCircleOutlined />;
      default: return <ClockCircleOutlined />;
    }
  };

  const getStepTitle = (type: string) => {
    switch (type) {
      case 'intent_analysis': return '意图分析';
      case 'task_decomposition': return '任务分解';
      case 'tool_selection': return '工具调用';
      case 'result_synthesis': return '结果整合';
      default: return '处理中';
    }
  };

  const getToolIcon = (name: string) => {
    switch (name) {
      case 'getWeather': return <CloudOutlined />;
      case 'searchSpots': return <GlobalOutlined />;
      case 'sendEmail': return <MailOutlined />;
      case 'generatePlan': return <PlayCircleOutlined />;
      default: return <ThunderboltOutlined />;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        style={{ flex: 1 }}
        tabBarStyle={{ marginBottom: 0, padding: '0 16px' }}
      >
        <Tabs.TabPane tab="溜娃助手" key="panel">
          <div style={{ padding: 16, height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
            {/* 结果展示区 */}
            <div style={{ flex: 1, overflowY: 'auto', marginBottom: 16 }}>
              {currentResult ? (
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                  {/* 天气卡片 */}
                  {currentResult.weather && (
                    <>
                      {currentResult.weather.saturday ? (
                        <Space direction="vertical" style={{ width: '100%' }} size="middle">
                          <Card
                            title={`${getWeatherIcon(currentResult.weather.saturday?.weather)} 周六天气 (${currentResult.weather.saturday?.date})`}
                            size="small"
                            extra={
                              <Tag color={currentResult.weather.saturday?.suitableForKids ? 'success' : 'error'}>
                                {currentResult.weather.saturday?.suitableForKids ? '适宜出行' : '不太适宜'}
                              </Tag>
                            }
                          >
                            <Descriptions size="small" column={3}>
                              <Descriptions.Item label="温度">{currentResult.weather.saturday?.tempMin}°C ~ {currentResult.weather.saturday?.tempMax}°C</Descriptions.Item>
                              <Descriptions.Item label="天气">{currentResult.weather.saturday?.weather}</Descriptions.Item>
                              <Descriptions.Item label="湿度">{currentResult.weather.saturday?.humidity}%</Descriptions.Item>
                            </Descriptions>
                            <div style={{ marginTop: 8, color: '#666', fontSize: 13 }}>
                              {currentResult.weather.saturday?.tips}
                            </div>
                          </Card>
                          <Card
                            title={`${getWeatherIcon(currentResult.weather.sunday?.weather)} 周日天气 (${currentResult.weather.sunday?.date})`}
                            size="small"
                            extra={
                              <Tag color={currentResult.weather.sunday?.suitableForKids ? 'success' : 'error'}>
                                {currentResult.weather.sunday?.suitableForKids ? '适宜出行' : '不太适宜'}
                              </Tag>
                            }
                          >
                            <Descriptions size="small" column={3}>
                              <Descriptions.Item label="温度">{currentResult.weather.sunday?.tempMin}°C ~ {currentResult.weather.sunday?.tempMax}°C</Descriptions.Item>
                              <Descriptions.Item label="天气">{currentResult.weather.sunday?.weather}</Descriptions.Item>
                              <Descriptions.Item label="湿度">{currentResult.weather.sunday?.humidity}%</Descriptions.Item>
                            </Descriptions>
                            <div style={{ marginTop: 8, color: '#666', fontSize: 13 }}>
                              {currentResult.weather.sunday?.tips}
                            </div>
                          </Card>
                          <div style={{ background: '#f0f5ff', padding: '8px 12px', borderRadius: 4, fontSize: 14 }}>
                             {currentResult.weather.summary}
                          </div>
                        </Space>
                      ) : (
                        <Card
                          title={`${getWeatherIcon(currentResult.weather.weather)} 天气信息`}
                          size="small"
                          extra={
                            <Tag color={currentResult.weather.suitableForKids ? 'success' : 'error'}>
                              {currentResult.weather.suitableForKids ? '适宜出行' : '不太适宜'}
                            </Tag>
                          }
                        >
                          <Descriptions size="small" column={3}>
                            <Descriptions.Item label="温度">{currentResult.weather.temp}°C</Descriptions.Item>
                            <Descriptions.Item label="天气">{currentResult.weather.weather}</Descriptions.Item>
                            <Descriptions.Item label="湿度">{currentResult.weather.humidity}%</Descriptions.Item>
                            <Descriptions.Item label="风力">{currentResult.weather.windSpeed}m/s</Descriptions.Item>
                            <Descriptions.Item label="空气质量">{currentResult.weather.airQuality}</Descriptions.Item>
                            <Descriptions.Item label="日期">{currentResult.weather.date}</Descriptions.Item>
                          </Descriptions>
                          <div style={{ marginTop: 8, color: '#666', fontSize: 13 }}>
                             {currentResult.weather.tips}
                          </div>
                        </Card>
                      )}
                    </>
                  )}

                  {/* 景点列表 */}
                  {currentResult.spots && currentResult.spots.length > 0 && (
                    <Card title=" 推荐景点" size="small">
                      <List
                        dataSource={currentResult.spots}
                        renderItem={(spot: SpotInfo) => (
                          <List.Item
                            actions={[
                              <Button
                                type="link"
                                size="small"
                                onClick={() => handleMarkVisited(spot.name)}
                              >
                                标记已玩
                              </Button>,
                              <Button
                                type="link"
                                size="small"
                                icon={<CarOutlined />}
                                onClick={() => openNavigation(spot)}
                              >
                                导航
                              </Button>,
                            ]}
                          >
                            <List.Item.Meta
                              title={
                                <Space>
                                  <a
                                    href="#"
                                    onClick={(e) => { e.preventDefault(); openNavigation(spot); }}
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#1890ff', cursor: 'pointer' }}
                                  >
                                    <HomeOutlined />
                                    {spot.name}
                                    <CarOutlined style={{ fontSize: 12, color: '#999' }} />
                                  </a>
                                  <Tag color="blue">{spot.category}</Tag>
                                  <Tag>适合 {spot.ageRange} 岁</Tag>
                                </Space>
                              }
                              description={
                                <Space split={<Divider type="vertical" />}>
                                  <span>{spot.address}</span>
                                  <span>距离 {spot.distance}km</span>
                                  <span>门票 {spot.ticketPrice}</span>
                                  <span>⭐ {spot.rating}</span>
                                </Space>
                              }
                            />
                          </List.Item>
                        )}
                      />
                    </Card>
                  )}

                  {/* AI 计划 */}
                  {currentResult.plan && (
                    <Card title=" 溜娃计划" size="small">
                      <div style={{ fontSize: 15, lineHeight: 1.8 }}>
                        <ReactMarkdown>{currentResult.plan.summary}</ReactMarkdown>
                      </div>
                      {currentResult.plan.tips && (
                        <>
                          <Divider>温馨提示</Divider>
                          <ul style={{ paddingLeft: 20 }}>
                            {currentResult.plan.tips.map((tip: string, i: number) => (
                              <li key={i} style={{ marginBottom: 4, color: '#666' }}>{tip}</li>
                            ))}
                          </ul>
                        </>
                      )}
                      <Divider />
                      <Statistic
                        title="预计总费用"
                        value={currentResult.plan.totalCost || 0}
                        prefix="¥"
                        valueStyle={{ color: '#1890ff' }}
                      />
                    </Card>
                  )}

                  {currentResult.emailSent && (
                    <Card size="small" style={{ background: '#f6ffed' }}>
                      <Space>
                        <CheckCircleOutlined style={{ color: '#52c41a' }} />
                        <span>邮件已发送至 {emailTo || '您的邮箱'}</span>
                      </Space>
                    </Card>
                  )}
                </Space>
              ) : (
                <Empty description="输入需求，开始规划溜娃行程" style={{ marginTop: 100 }} />
              )}
            </div>

            {/* 执行过程追踪 */}
            {trace && (
              <Collapse defaultActiveKey={[]} style={{ marginBottom: 16 }}>
                <Panel header={
                  <Space>
                    <SyncOutlined spin={!trace.completedAt} />
                    执行过程追踪
                    {trace.totalDuration && (
                      <Tag>{trace.totalDuration}ms</Tag>
                    )}
                  </Space>
                } key="trace">
                  {/* 思考过程 */}
                  {trace.reasoningSteps && trace.reasoningSteps.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <h4 style={{ marginBottom: 8 }}>🧠 思考过程</h4>
                      <Timeline
                        items={trace.reasoningSteps.map((step: any) => ({
                          color: step.type === 'result_synthesis' ? 'green' : 'blue',
                          children: (
                            <div>
                              <Space>
                                {getStepIcon(step.type)}
                                <strong>{getStepTitle(step.type)}</strong>
                              </Space>
                              <p style={{ margin: '4px 0 0 24px', color: '#666', fontSize: 13 }}>
                                {step.content}
                              </p>
                            </div>
                          ),
                        }))}
                      />
                    </div>
                  )}

                  {/* 工具调用记录 */}
                  {trace.toolCalls && trace.toolCalls.length > 0 && (
                    <div>
                      <h4 style={{ marginBottom: 8 }}> 工具调用记录</h4>
                      {trace.toolCalls.map((call: any, idx: number) => (
                        <Card key={idx} size="small" style={{ marginBottom: 8 }}>
                          <Space>
                            {getToolIcon(call.toolName)}
                            <strong>{call.toolName}</strong>
                            <Tag color="success">
                              {call.result !== null ? '成功' : '执行中'}
                            </Tag>
                            {call.duration && <Tag>{call.duration}ms</Tag>}
                          </Space>
                          <Divider style={{ margin: '8px 0' }} />
                          <Descriptions size="small" column={1}>
                            <Descriptions.Item label="输入参数">
                              <pre style={{ margin: 0, fontSize: 12, background: '#f5f5f5', padding: 4, borderRadius: 4 }}>
                                {JSON.stringify(call.arguments, null, 2)}
                              </pre>
                            </Descriptions.Item>
                            {call.result && (
                              <Descriptions.Item label="返回结果">
                                <pre style={{ margin: 0, fontSize: 12, background: '#f5f5f5', padding: 4, borderRadius: 4, maxHeight: 150, overflow: 'auto' }}>
                                  {JSON.stringify(call.result, null, 2).substring(0, 500)}
                                </pre>
                              </Descriptions.Item>
                            )}
                          </Descriptions>
                          {call.attempts && call.attempts.length > 0 && (
                            <div style={{ marginTop: 8 }}>
                              <span style={{ fontSize: 12, color: '#999' }}>
                                尝试次数: {call.attempts.length}
                              </span>
                            </div>
                          )}
                        </Card>
                      ))}
                    </div>
                  )}
                </Panel>
              </Collapse>
            )}

            {/* 输入区域 */}
            <div style={{ background: '#fff', padding: 16, borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'flex', gap: 12, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <Badge dot={!!userLocation} color="green">
                  <Space>
                    <EnvironmentOutlined />
                    <span style={{ fontSize: 13, color: userLocation ? '#52c41a' : '#999' }}>
                      {locationLoading ? '定位中...' : userLocation ? userLocation.city || `${userLocation.lat.toFixed(2)}, ${userLocation.lng.toFixed(2)}` : '未定位'}
                    </span>
                    <Button type="link" size="small" onClick={detectLocation} style={{ padding: 0, height: 'auto' }}>
                      刷新
                    </Button>
                  </Space>
                </Badge>
                <Space>
                  <span style={{ fontSize: 13, color: '#666' }}>孩子年龄:</span>
                  <Input
                    type="number"
                    value={childAge}
                    onChange={e => setChildAge(parseInt(e.target.value) || 5)}
                    style={{ width: 80 }}
                    min={1}
                    max={18}
                    size="small"
                  />
                </Space>
                <Space>
                  <MailOutlined />
                  <Input
                    placeholder="接收邮箱 (可选)"
                    value={emailTo}
                    onChange={e => setEmailTo(e.target.value)}
                    style={{ width: 200 }}
                    size="small"
                  />
                </Space>
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    loadTasks();
                    loadVisitedSpots();
                    setActiveTab('history');
                  }}
                >
                  查看历史
                </Button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <TextArea
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  onPressEnter={e => !e.shiftKey && (e.preventDefault(), handleExecute())}
                  placeholder="例如：推荐适合5岁小孩、距离5km内、票价100元以内的周末活动"
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  style={{ flex: 1 }}
                />
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={handleExecute}
                  loading={loading}
                >
                  执行
                </Button>
              </div>
            </div>
          </div>
        </Tabs.TabPane>

        <Tabs.TabPane tab="历史记录" key="history">
          <div style={{ padding: 16, height: 'calc(100vh - 120px)', overflowY: 'auto' }}>
            <Card title="任务历史" size="small" style={{ marginBottom: 16 }}>
              <List
                dataSource={tasks}
                renderItem={(item: any) => (
                  <List.Item
                    style={{ cursor: 'pointer', padding: '12px 16px' }}
                    onClick={() => handleViewTask(item)}
                    className="hoverable-row"
                  >
                    <List.Item.Meta
                      title={
                        <Space>
                          {item.status === 'completed' ? (
                            <CheckCircleOutlined style={{ color: '#52c41a' }} />
                          ) : (
                            <ClockCircleOutlined />
                          )}
                          {item.title}
                        </Space>
                      }
                      description={
                        <Space split={<Divider type="vertical" />}>
                          <span>{new Date(item.createdAt).toLocaleString()}</span>
                          {item.emailSent && <Tag color="success">已发邮件</Tag>}
                        </Space>
                      }
                    />
                    <Button type="link" size="small">查看详情</Button>
                  </List.Item>
                )}
              />
            </Card>

            {/* 选中任务的详情面板 */}
            {selectedTaskTrace && (
              <Card
                title={
                  <Space>
                    <EyeOutlined />
                    任务详情: {selectedTaskTrace.task?.title || selectedTaskTrace.id}
                    <Button type="link" size="small" onClick={() => setSelectedTaskTrace(null)}>关闭</Button>
                  </Space>
                }
                size="small"
                style={{ marginBottom: 16 }}
              >
                {/* 基本信息 */}
                <Descriptions size="small" column={3} bordered style={{ marginBottom: 16 }}>
                  <Descriptions.Item label="任务ID">{selectedTaskTrace.id}</Descriptions.Item>
                  <Descriptions.Item label="状态">
                    <Tag color={selectedTaskTrace.task?.status === 'completed' ? 'success' : 'default'}>
                      {selectedTaskTrace.task?.status || 'unknown'}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="总耗时">
                    {selectedTaskTrace.totalDuration ? `${selectedTaskTrace.totalDuration}ms` : '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="创建时间" span={3}>
                    {selectedTaskTrace.startedAt ? new Date(selectedTaskTrace.startedAt).toLocaleString() : '-'}
                  </Descriptions.Item>
                </Descriptions>

                {/* 思考过程 */}
                {selectedTaskTrace.reasoningSteps && selectedTaskTrace.reasoningSteps.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <h4 style={{ marginBottom: 8 }}>🧠 思考过程</h4>
                    <Timeline
                      items={selectedTaskTrace.reasoningSteps.map((step: any) => ({
                        color: step.type === 'result_synthesis' ? 'green' : 'blue',
                        children: (
                          <div>
                            <Space>
                              {getStepIcon(step.type)}
                              <strong>{getStepTitle(step.type)}</strong>
                            </Space>
                            <p style={{ margin: '4px 0 0 24px', color: '#666', fontSize: 13 }}>
                              {step.content}
                            </p>
                            {step.metadata && Object.keys(step.metadata).length > 0 && (
                              <pre style={{ margin: '4px 0 0 24px', fontSize: 11, background: '#f5f5f5', padding: 4, borderRadius: 4 }}>
                                {JSON.stringify(step.metadata, null, 2)}
                              </pre>
                            )}
                          </div>
                        ),
                      }))}
                    />
                  </div>
                )}

                {/* 工具调用记录 */}
                {selectedTaskTrace.toolCalls && selectedTaskTrace.toolCalls.length > 0 && (
                  <div>
                    <h4 style={{ marginBottom: 8 }}>🔧 工具调用记录</h4>
                    {selectedTaskTrace.toolCalls.map((call: any, idx: number) => (
                      <Card key={idx} size="small" style={{ marginBottom: 8 }}>
                        <Space>
                          {getToolIcon(call.toolName)}
                          <strong>{call.toolName}</strong>
                          <Tag color="success">
                            {call.result !== null ? '成功' : '执行中'}
                          </Tag>
                          {call.duration && <Tag>{call.duration}ms</Tag>}
                        </Space>
                        <Divider style={{ margin: '8px 0' }} />
                        <Descriptions size="small" column={1}>
                          <Descriptions.Item label="输入参数">
                            <pre style={{ margin: 0, fontSize: 12, background: '#f5f5f5', padding: 4, borderRadius: 4 }}>
                              {JSON.stringify(call.arguments, null, 2)}
                            </pre>
                          </Descriptions.Item>
                          {call.result && (
                            <Descriptions.Item label="返回结果">
                              <pre style={{ margin: 0, fontSize: 12, background: '#f5f5f5', padding: 4, borderRadius: 4, maxHeight: 150, overflow: 'auto' }}>
                                {JSON.stringify(call.result, null, 2).substring(0, 500)}
                              </pre>
                            </Descriptions.Item>
                          )}
                        </Descriptions>
                      </Card>
                    ))}
                  </div>
                )}

                {/* 最终结果 */}
                {selectedTaskTrace.finalOutput && (
                  <>
                    <Divider>最终结果</Divider>
                    <div style={{ fontSize: 14, lineHeight: 1.8, color: '#333' }}>
                      <ReactMarkdown>{selectedTaskTrace.finalOutput}</ReactMarkdown>
                    </div>
                  </>
                )}
              </Card>
            )}

            <Card title="游玩记录" size="small">
              <List
                dataSource={visitedSpots}
                renderItem={(spot: any) => (
                  <List.Item>
                    <List.Item.Meta
                      title={
                        <Space>
                          <HomeOutlined />
                          {spot.name}
                          <Tag>{spot.category}</Tag>
                        </Space>
                      }
                      description={
                        <Space direction="vertical" size={0}>
                          <span>{spot.address || '无地址'}</span>
                          {spot.visitedAt && (
                            <span style={{ color: '#999', fontSize: 12 }}>
                              游玩时间: {new Date(spot.visitedAt).toLocaleDateString()}
                            </span>
                          )}
                          {spot.experience && (
                            <span style={{ color: '#666' }}>体验: {spot.experience}</span>
                          )}
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            </Card>
          </div>
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
}
