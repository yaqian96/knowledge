import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WeatherService, WeatherData, WeekendWeather } from '../weather/weather.service';
import { SpotsService, SpotInfo } from '../spots/spots.service';
import { EmailService } from '../email/email.service';
import { LangSmithService } from '../langsmith/langsmith.service';
import { BabyTripRequest, BabyTripResponse, ToolCallRecord, ReasoningStep } from './baby-trip.types';
import { generateId } from '../../common/utils/id-generator';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const dashscope = createOpenAICompatible({
  name: 'dashscope',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.DASHSCOPE_API_KEY || '',
});
const model = dashscope('qwen-plus');

@Injectable()
export class BabyTripService {
  private readonly logger = new Logger(BabyTripService.name);

  constructor(
    private prisma: PrismaService,
    private weatherService: WeatherService,
    private spotsService: SpotsService,
    private emailService: EmailService,
    private langSmith: LangSmithService,
  ) {}

  async execute(request: BabyTripRequest): Promise<BabyTripResponse> {
    const startTime = Date.now();
    const taskId = generateId();
    const userId = request.userId;
    const lat = request.lat || parseFloat(process.env.DEFAULT_LATITUDE || '39.9042');
    const lng = request.lng || parseFloat(process.env.DEFAULT_LONGITUDE || '116.4074');
    const childAge = request.childAge || parseInt(process.env.DEFAULT_CHILD_AGE || '5');
    const msg = request.message;

    // 从用户消息中解析距离限制（如"5km"）
    const distMatch = msg.match(/(\d+)\s*km/);
    const radius = distMatch ? parseInt(distMatch[1]) * 1000 : 10000;

    // 从用户消息中解析票价限制（如"100元"）
    const priceMatch = msg.match(/票价\s*(\d+)\s*元/);
    const maxPrice = priceMatch ? parseInt(priceMatch[1]) : null;

    const reasoningSteps: ReasoningStep[] = [];
    const toolCalls: ToolCallRecord[] = [];

    try {
      const task = await this.prisma.babyTripTask.create({
        data: {
          id: taskId,
          userId,
          title: request.message.substring(0, 50),
          description: request.message,
          status: 'running',
        },
      });

      reasoningSteps.push({
        stepIndex: 0,
        timestamp: new Date().toISOString(),
        type: 'intent_analysis',
        content: `用户意图: ${request.message}`,
        metadata: { lat, lng, childAge, radius: radius / 1000 + 'km', maxPrice: maxPrice ? '¥' + maxPrice : '不限' },
      });

      reasoningSteps.push({
        stepIndex: 1,
        timestamp: new Date().toISOString(),
        type: 'task_decomposition',
        content: '任务分解: 1)查询天气 2)搜索景点 3)生成计划 4)发送邮件(如需要)',
      });

      const today = new Date().toISOString().split('T')[0];
      const isWeekendQuery = /周末|星期六|星期日|周六|周日|双休/i.test(request.message);

      let weather: WeatherData | WeekendWeather;
      let weatherToolName = 'getWeather';

      if (isWeekendQuery) {
        reasoningSteps.push({
          stepIndex: 2,
          timestamp: new Date().toISOString(),
          type: 'intent_analysis',
          content: '检测到"周末"关键词，将查询本周六和周日的天气预报',
        });

        const weekendToolId = generateId();
        const weatherStart = Date.now();
        toolCalls.push({
          id: weekendToolId,
          toolName: 'getWeekendWeather',
          timestamp: new Date().toISOString(),
          arguments: { lat, lng },
          result: null,
          attempts: [],
          duration: 0,
        });

        const weekendWeather = await this.weatherService.getWeekendWeather(lat, lng);
        const weatherDuration = Date.now() - weatherStart;
        const weatherIdx = toolCalls.findIndex(t => t.id === weekendToolId);
        toolCalls[weatherIdx] = {
          ...toolCalls[weatherIdx],
          result: weekendWeather,
          attempts: [{ attemptIndex: 1, timestamp: new Date().toISOString(), arguments: { lat, lng }, success: true, result: weekendWeather }],
          duration: weatherDuration,
        };

        weather = weekendWeather;
        weatherToolName = 'getWeekendWeather';

        reasoningSteps.push({
          stepIndex: 3,
          timestamp: new Date().toISOString(),
          type: 'tool_selection',
          content: `周末天气: 周六${weekendWeather.saturday.weather} ${weekendWeather.saturday.temp}°C, 周日${weekendWeather.sunday.weather} ${weekendWeather.sunday.temp}°C. ${weekendWeather.summary}`,
          metadata: weekendWeather,
        });
      } else {
        const weatherToolId = generateId();
        const weatherStart = Date.now();
        toolCalls.push({
          id: weatherToolId,
          toolName: 'getWeather',
          timestamp: new Date().toISOString(),
          arguments: { lat, lng, date: today },
          result: null,
          attempts: [],
          duration: 0,
        });

        const singleWeather = await this.weatherService.getWeather(lat, lng, today);
        const weatherDuration = Date.now() - weatherStart;
        const weatherIdx = toolCalls.findIndex(t => t.id === weatherToolId);
        toolCalls[weatherIdx] = {
          ...toolCalls[weatherIdx],
          result: singleWeather,
          attempts: [{ attemptIndex: 1, timestamp: new Date().toISOString(), arguments: { lat, lng, date: today }, success: true, result: singleWeather }],
          duration: weatherDuration,
        };

        weather = singleWeather;

        reasoningSteps.push({
          stepIndex: 2,
          timestamp: new Date().toISOString(),
          type: 'tool_selection',
          content: `查询天气: ${singleWeather.weather} ${singleWeather.temp}°C, 适宜性: ${singleWeather.suitableForKids ? '适宜' : '不适宜'}`,
          metadata: singleWeather,
        });
      }

      const spotsToolId = generateId();
      const spotsStart = Date.now();
      toolCalls.push({
        id: spotsToolId,
        toolName: 'searchSpots',
        timestamp: new Date().toISOString(),
        arguments: { lat, lng, radius: radius / 1000 + 'km', childAge, maxPrice },
        result: null,
        attempts: [],
        duration: 0,
      });

      let spots = await this.spotsService.searchSpots(lat, lng, radius, childAge);
      if (maxPrice !== null) {
        spots = spots.filter(s => {
          const match = s.ticketPrice.match(/¥(\d+)/);
          return !match || parseInt(match[1]) <= maxPrice;
        });
      }
      const spotsDuration = Date.now() - spotsStart;
      const spotsIdx = toolCalls.findIndex(t => t.id === spotsToolId);
      toolCalls[spotsIdx] = {
        ...toolCalls[spotsIdx],
        result: spots,
        attempts: [{ attemptIndex: 1, timestamp: new Date().toISOString(), arguments: { lat, lng, radius, childAge, maxPrice }, success: true, result: spots }],
        duration: spotsDuration,
      };

      reasoningSteps.push({
        stepIndex: isWeekendQuery ? 4 : 3,
        timestamp: new Date().toISOString(),
        type: 'tool_selection',
        content: `搜索到 ${spots.length} 个适合 ${childAge} 岁儿童的景点`,
        metadata: { count: spots.length },
      });

      reasoningSteps.push({
        stepIndex: isWeekendQuery ? 5 : 4,
        timestamp: new Date().toISOString(),
        type: 'result_synthesis',
        content: '正在生成溜娃计划...',
      });

      const plan = await this.generatePlan(weather, spots, childAge, request.message, isWeekendQuery);

      let emailSent = false;
      let emailResult: any = null;
      if (request.emailTo || request.message.includes('邮件') || request.message.includes('email')) {
        const emailTo = request.emailTo || await this.getUserEmail(userId);
        if (emailTo) {
          const singleW = !isWeekendQuery ? (weather as WeatherData) : (weather as WeekendWeather).saturday;
          const { html, text } = this.emailService.generatePlanHtml({
            date: isWeekendQuery ? `${(weather as WeekendWeather).saturday.date} ~ ${(weather as WeekendWeather).sunday.date}` : today,
            weather: singleW,
            spots: spots.slice(0, 3),
            totalCost: this.calculateTotalCost(spots.slice(0, 3)),
            tips: plan.tips,
            summary: plan.summary,
            userMessage: request.message,
            childAge,
            weekendWeather: isWeekendQuery ? (weather as WeekendWeather) : undefined,
          });

          const emailRes = await this.emailService.sendEmail({
            to: emailTo,
            subject: ` ${isWeekendQuery ? '本周末' : today} 溜娃计划推荐`,
            html,
            text,
          });
          emailSent = emailRes.success;
          emailResult = emailRes;

          await this.prisma.emailLog.create({
            data: {
              userId,
              taskId,
              to: emailTo,
              subject: `🎒 ${isWeekendQuery ? '本周末' : today} 溜娃计划推荐`,
              content: html,
              status: emailRes.success ? 'sent' : 'failed',
              errorMsg: emailRes.error,
              sentAt: emailRes.success ? new Date() : undefined,
            },
          });

          reasoningSteps.push({
            stepIndex: isWeekendQuery ? 6 : 5,
            timestamp: new Date().toISOString(),
            type: 'tool_selection',
            content: `邮件发送: ${emailSent ? '成功' : '失败'}`,
            metadata: emailResult,
          });
        }
      }

      const totalDuration = Date.now() - startTime;
      await this.prisma.babyTripTrace.create({
        data: {
          taskId,
          userId,
          reasoningSteps: JSON.parse(JSON.stringify(reasoningSteps)),
          toolCalls: JSON.parse(JSON.stringify(toolCalls)),
          finalOutput: plan.summary,
          totalDuration,
          startedAt: new Date(startTime),
          completedAt: new Date(),
        },
      });

      await this.prisma.babyTripTask.update({
        where: { id: taskId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          emailSent,
          emailSentAt: emailSent ? new Date() : undefined,
          spotIds: JSON.stringify(spots.slice(0, 3).map(s => s.name)),
        },
      });

      return {
        success: true,
        message: plan.summary,
        data: {
          taskId,
          weather,
          spots: spots.slice(0, 3),
          plan,
          emailSent,
          totalDuration,
        },
        traceId: taskId,
      };
    } catch (err) {
      this.logger.error(`BabyTrip execution failed: ${err.message}`);
      return {
        success: false,
        message: `执行失败: ${err.message}`,
      };
    }
  }

  private async generatePlan(weather: WeatherData | WeekendWeather, spots: SpotInfo[], childAge: number, userMessage: string, isWeekend: boolean): Promise<any> {
    let weatherDesc: string;
    if (isWeekend && 'saturday' in weather) {
      const w = weather as WeekendWeather;
      weatherDesc = `周六: ${w.saturday.weather} ${w.saturday.temp}°C (${w.saturday.dayOfWeek}), 周日: ${w.sunday.weather} ${w.sunday.temp}°C (${w.sunday.dayOfWeek}). ${w.summary}`;
    } else {
      const w = weather as WeatherData;
      weatherDesc = `${w.weather} ${w.temp}°C (${w.dayOfWeek}), 适宜性: ${w.suitableForKids ? '适宜' : '不适宜'}`;
    }

    const prompt = `你是一个专业的溜娃规划师。根据以下信息，为${childAge}岁孩子规划一个${isWeekend ? '周末' : ''}出行方案：

天气: ${weatherDesc}

可用景点:
${spots.map(s => `- ${s.name} (${s.distance}km), ${s.ticketPrice}, 适合${s.ageRange}岁, 评分${s.rating}`).join('\n')}

用户需求: ${userMessage}

请以JSON格式返回，包含:
- summary: 一句话总结
- tips: 温馨提示列表
- totalCost: 预计总费用

只返回JSON，不要其他内容。`;

    try {
      const generateText = this.langSmith.getGenerateText();
      const { text } = await generateText({
        model,
        prompt,
        temperature: 0.7,
        providerOptions: this.langSmith.isEnabled() ? {
          langsmith: (() => {
            return require('langsmith/experimental/vercel').createLangSmithProviderOptions({
              name: 'baby-trip-planner',
              metadata: { user_id: 'baby-trip', type: 'plan_generation' },
              tags: ['baby-trip', 'qwen-plus'],
            });
          })(),
        } : undefined,
      });
      try {
        const parsed = JSON.parse(text);
        const primaryWeather = isWeekend && 'saturday' in weather ? (weather as WeekendWeather).saturday : (weather as WeatherData);
        return {
          summary: parsed.summary || '为您规划了以下溜娃方案',
          tips: parsed.tips || [primaryWeather.tips, '记得带水和零食', '注意防晒'],
          totalCost: parsed.totalCost || this.calculateTotalCost(spots.slice(0, 3)),
        };
      } catch {
        const primaryWeather = isWeekend && 'saturday' in weather ? (weather as WeekendWeather).saturday : (weather as WeatherData);
        return {
          summary: text.substring(0, 200),
          tips: [primaryWeather.tips, '记得带水和零食', '注意防晒'],
          totalCost: this.calculateTotalCost(spots.slice(0, 3)),
        };
      }
    } catch {
      return {
        summary: '为您规划了以下溜娃方案',
        tips: ['记得带水和零食', '注意防晒'],
        totalCost: this.calculateTotalCost(spots.slice(0, 3)),
      };
    }
  }

  private calculateTotalCost(spots: SpotInfo[]): number {
    return spots.reduce((sum, s) => {
      const match = s.ticketPrice.match(/¥(\d+)/);
      return sum + (match ? parseInt(match[1]) : 0);
    }, 0);
  }

  private async getUserEmail(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    return user?.email || '';
  }

  async getTasks(userId: string, status?: string) {
    return this.prisma.babyTripTask.findMany({
      where: { userId, ...(status && { status: { equals: status } }) },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  async getTrace(taskId: string, userId: string) {
    return this.prisma.babyTripTrace.findFirst({
      where: { taskId, userId },
      include: { task: true },
    });
  }

  async getVisitedSpots(userId: string) {
    return this.prisma.spot.findMany({
      where: { userId, visitedAt: { not: null } },
      orderBy: { visitedAt: 'desc' },
    });
  }

  async markVisited(userId: string, spotName: string, experience?: string) {
    const existing = await this.prisma.spot.findFirst({
      where: { userId, name: spotName },
    });

    if (existing) {
      return this.prisma.spot.update({
        where: { id: existing.id },
        data: { visitedAt: new Date(), experience },
      });
    }

    return this.prisma.spot.create({
      data: {
        userId,
        name: spotName,
        address: '',
        latitude: 0,
        longitude: 0,
        category: '未知',
        visitedAt: new Date(),
        experience,
      },
    });
  }
}
