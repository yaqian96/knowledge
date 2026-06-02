import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;
  private configured: boolean;

  constructor(private configService: ConfigService) {
    this.configureTransporter();
  }

  private configureTransporter() {
    const host = this.configService.get<string>('EMAIL_SMTP_HOST');
    const port = this.configService.get<number>('EMAIL_SMTP_PORT');
    const user = this.configService.get<string>('EMAIL_SMTP_USER');
    const pass = this.configService.get<string>('EMAIL_SMTP_PASS');
    const fromName = this.configService.get<string>('EMAIL_FROM_NAME', '溜娃助手');

    if (host && port && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: true,
        auth: { user, pass },
      });
      this.configured = true;
      this.logger.log(`QQ邮箱 SMTP 已配置: ${user}`);
    } else {
      this.configured = false;
      this.logger.warn('QQ邮箱 SMTP 未配置，邮件功能将使用模拟模式');
    }
  }

  async sendEmail(options: EmailOptions): Promise<EmailResult> {
    if (!this.configured) {
      this.logger.log(`[模拟发送] 邮件已"发送": to=${options.to}, subject=${options.subject}`);
      return { success: true, messageId: 'mock-' + Date.now() };
    }

    try {
      const fromName = this.configService.get<string>('EMAIL_FROM_NAME', '溜娃助手');
      const info = await this.transporter.sendMail({
        from: `"${fromName}" <${this.configService.get<string>('EMAIL_SMTP_USER')}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
      this.logger.log(`邮件发送成功: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (err) {
      this.logger.error(`邮件发送失败: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  generatePlanHtml(plan: {
    date: string;
    weather: any;
    spots: any[];
    totalCost: number;
    tips: string[];
    summary?: string;
    userMessage?: string;
    childAge?: number;
    weekendWeather?: any;
  }): { html: string; text: string } {
    const weatherIcon = this.getWeatherIcon(plan.weather?.weather);
    const spotsHtml = plan.spots.map((s: any, i: number) => `
      <div style="border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px; margin: 8px 0;">
        <strong>${i + 1}. ${s.name}</strong> <span style="color: #999;">(${s.distance}km)</span><br/>
        <span style="font-size: 12px; color: #666;">${s.address}</span><br/>
        <span>门票: ${s.ticketPrice}</span> | <span>评分: ${s.rating}</span> | <span>适合年龄: ${s.ageRange}岁</span>
      </div>
    `).join('');

    const tipsHtml = plan.tips.map(t => `<li>${t}</li>`).join('');

    let weatherSection = '';
    if (plan.weekendWeather) {
      const satIcon = this.getWeatherIcon(plan.weekendWeather.saturday?.weather);
      const sunIcon = this.getWeatherIcon(plan.weekendWeather.sunday?.weather);
      weatherSection = `
        <h3>📅 周末天气详情</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr style="background: #f0f5ff;">
            <th style="border: 1px solid #d9d9d9; padding: 8px; text-align: left;">日期</th>
            <th style="border: 1px solid #d9d9d9; padding: 8px; text-align: left;">天气</th>
            <th style="border: 1px solid #d9d9d9; padding: 8px; text-align: left;">温度</th>
            <th style="border: 1px solid #d9d9d9; padding: 8px; text-align: left;">适宜性</th>
            <th style="border: 1px solid #d9d9d9; padding: 8px; text-align: left;">出行建议</th>
          </tr>
          <tr>
            <td style="border: 1px solid #d9d9d9; padding: 8px;">${plan.weekendWeather.saturday?.dayOfWeek} ${plan.weekendWeather.saturday?.date}</td>
            <td style="border: 1px solid #d9d9d9; padding: 8px;">${satIcon} ${plan.weekendWeather.saturday?.weather}</td>
            <td style="border: 1px solid #d9d9d9; padding: 8px;">${plan.weekendWeather.saturday?.tempMin}°C ~ ${plan.weekendWeather.saturday?.tempMax}°C</td>
            <td style="border: 1px solid #d9d9d9; padding: 8px;">${plan.weekendWeather.saturday?.suitableForKids ? '✅ 适宜' : '⚠️ 不太适宜'}</td>
            <td style="border: 1px solid #d9d9d9; padding: 8px; font-size: 12px;">${plan.weekendWeather.saturday?.tips}</td>
          </tr>
          <tr>
            <td style="border: 1px solid #d9d9d9; padding: 8px;">${plan.weekendWeather.sunday?.dayOfWeek} ${plan.weekendWeather.sunday?.date}</td>
            <td style="border: 1px solid #d9d9d9; padding: 8px;">${sunIcon} ${plan.weekendWeather.sunday?.weather}</td>
            <td style="border: 1px solid #d9d9d9; padding: 8px;">${plan.weekendWeather.sunday?.tempMin}°C ~ ${plan.weekendWeather.sunday?.tempMax}°C</td>
            <td style="border: 1px solid #d9d9d9; padding: 8px;">${plan.weekendWeather.sunday?.suitableForKids ? '✅ 适宜' : '⚠️ 不太适宜'}</td>
            <td style="border: 1px solid #d9d9d9; padding: 8px; font-size: 12px;">${plan.weekendWeather.sunday?.tips}</td>
          </tr>
        </table>
        <p style="background: #f0f5ff; padding: 8px; border-radius: 4px; margin-top: 8px;">
          📊 ${plan.weekendWeather.summary}
        </p>
      `;
    } else {
      weatherSection = `
        <h3>📅 天气信息</h3>
        <p><strong>日期:</strong> ${plan.date}</p>
        <p><strong>天气:</strong> ${weatherIcon} ${plan.weather?.weather} ${plan.weather?.temp}°C ${plan.weather?.suitableForKids ? '✅ 适宜出行' : '⚠️ 不太适宜'}</p>
        ${plan.weather?.tips ? `<p style="background: #fff3e0; padding: 8px; border-radius: 4px;"> ${plan.weather.tips}</p>` : ''}
      `;
    }

    const userQuerySection = plan.userMessage ? `
      <div style="background: #f6ffed; padding: 10px; border-radius: 4px; border-left: 3px solid #52c41a; margin-bottom: 16px;">
        <strong> 您的需求：</strong>${plan.userMessage}
      </div>
    ` : '';

    const childAgeSection = plan.childAge ? `
      <p><strong>👶 孩子年龄：</strong>${plan.childAge} 岁</p>
    ` : '';

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1890ff;">🎒 溜娃计划推荐</h2>
        ${userQuerySection}
        <p><strong>📅 计划日期:</strong> ${plan.date}</p>
        ${childAgeSection}
        
        ${weatherSection}
        
        <h3>🏞️ 推荐景点 (${plan.spots.length}个)</h3>
        ${spotsHtml}
        
        <div style="background: #fff7e6; padding: 12px; border-radius: 8px; margin: 16px 0;">
          <p style="margin: 0; font-size: 16px;"><strong>💰 预计总费用：</strong><span style="color: #fa8c16; font-size: 20px; font-weight: bold;">¥${plan.totalCost}</span></p>
          ${plan.spots.length > 0 ? `<p style="margin: 4px 0 0 0; font-size: 12px; color: #666;">费用明细: ${plan.spots.map((s: any) => `${s.name} ${s.ticketPrice}`).join(' | ')}</p>` : ''}
        </div>
        
        ${plan.summary ? `<h3> 方案总结</h3><p>${plan.summary}</p>` : ''}
        
        <h3>💡 温馨提示</h3>
        <ul>${tipsHtml}</ul>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="color: #999; font-size: 12px;">— 由溜娃助手自动生成 | 推荐景点来自高德地图 | 天气数据来自和风天气</p>
      </div>
    `;

    const text = `
🎒 溜娃计划推荐
日期: ${plan.date}
${plan.childAge ? `孩子年龄: ${plan.childAge} 岁` : ''}

天气: ${plan.weather?.weather} ${plan.weather?.temp}°C
${plan.weather?.tips || ''}

️ 推荐景点:
${plan.spots.map((s: any, i: number) => `${i + 1}. ${s.name} (${s.distance}km) - ${s.ticketPrice} - ${s.address}`).join('\n')}

💰 预计总费用: ¥${plan.totalCost}

${plan.summary ? `📋 方案总结: ${plan.summary}` : ''}

💡 温馨提示:
${plan.tips.join('\n')}
    `;

    return { html, text };
  }

  private getWeatherIcon(weather: string): string {
    if (!weather) return '🌤️';
    if (weather.includes('晴')) return '️';
    if (weather.includes('多云')) return '🌥️';
    if (weather.includes('阴')) return '☁️';
    if (weather.includes('雨')) return '🌧️';
    if (weather.includes('雪')) return '❄️';
    return '🌤️';
  }
}
