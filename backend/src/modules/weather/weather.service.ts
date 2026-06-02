import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface WeatherData {
  date: string;
  dayOfWeek: string;
  temp: number;
  tempMin?: number;
  tempMax?: number;
  weather: string;
  humidity: number;
  windSpeed: number;
  airQuality?: string;
  suitableForKids: boolean;
  tips: string;
}

export interface WeekendWeather {
  saturday: WeatherData;
  sunday: WeatherData;
  summary: string;
}

const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private apiKey: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('QWEATHER_API_KEY') || '';
  }

  async getWeather(lat: number, lng: number, date?: string): Promise<WeatherData> {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const d = new Date(targetDate);
    const dayOfWeek = DAY_NAMES[d.getDay()];

    if (!this.apiKey) {
      return this.getMockWeather(lat, lng, targetDate, dayOfWeek);
    }

    try {
      const forecastRes = await axios.get('https://devapi.qweather.com/v7/weather/3d', {
        params: { location: `${lng},${lat}`, key: this.apiKey },
      });
      const daily = forecastRes.data.daily || [];

      const airRes = await axios.get('https://devapi.qweather.com/v7/air/now', {
        params: { location: `${lng},${lat}`, key: this.apiKey },
      });
      const air = airRes.data.now;

      const dayForecast = daily.find((d: any) => d.fxDate === targetDate) || daily[0];
      if (!dayForecast) {
        return this.getMockWeather(lat, lng, targetDate, dayOfWeek);
      }

      const temp = (parseFloat(dayForecast.tempMin) + parseFloat(dayForecast.tempMax)) / 2;
      const weather = dayForecast.textDay;
      const humidity = parseInt(dayForecast.humidity) || 50;
      const windSpeed = parseFloat(dayForecast.windSpeedDay) || 0;
      const suitable = this.isSuitableForKids(temp, weather, air);

      return {
        date: targetDate,
        dayOfWeek,
        temp: Math.round(temp),
        tempMin: parseInt(dayForecast.tempMin),
        tempMax: parseInt(dayForecast.tempMax),
        weather,
        humidity,
        windSpeed,
        airQuality: air?.aqi ? this.getAqiLabel(parseInt(air.aqi)) : '未知',
        suitableForKids: suitable,
        tips: this.getWeatherTips(temp, weather, suitable),
      };
    } catch (err) {
      this.logger.warn(`天气API调用失败: ${err.message}, 使用模拟数据`);
      return this.getMockWeather(lat, lng, targetDate, dayOfWeek);
    }
  }

  async getWeekendWeather(lat: number, lng: number): Promise<WeekendWeather> {
    const today = new Date();
    const dayOfWeek = today.getDay();

    const daysUntilSaturday = (6 - dayOfWeek + 7) % 7 || 7;
    const saturday = new Date(today);
    saturday.setDate(today.getDate() + daysUntilSaturday);

    const sunday = new Date(saturday);
    sunday.setDate(saturday.getDate() + 1);

    const satDate = saturday.toISOString().split('T')[0];
    const sunDate = sunday.toISOString().split('T')[0];

    const [satWeather, sunWeather] = await Promise.all([
      this.getWeather(lat, lng, satDate),
      this.getWeather(lat, lng, sunDate),
    ]);

    const bothSuitable = satWeather.suitableForKids && sunWeather.suitableForKids;
    const oneSuitable = satWeather.suitableForKids || sunWeather.suitableForKids;
    const summary = bothSuitable
      ? '本周末两天天气都适宜出行'
      : oneSuitable
        ? '本周末有一天适宜出行，建议选择天气较好的一天'
        : '本周末天气不太适宜出行，建议改期';

    return {
      saturday: satWeather,
      sunday: sunWeather,
      summary,
    };
  }

  private isSuitableForKids(temp: number, weather: string, air: any): boolean {
    if (temp < 10 || temp > 35) return false;
    if (weather.includes('暴雨') || weather.includes('大雪') || weather.includes('台风')) return false;
    if (air?.aqi && parseInt(air.aqi) > 150) return false;
    return true;
  }

  private getAqiLabel(aqi: number): string {
    if (aqi <= 50) return '优';
    if (aqi <= 100) return '良';
    if (aqi <= 150) return '轻度污染';
    if (aqi <= 200) return '中度污染';
    return '重度污染';
  }

  private getWeatherTips(temp: number, weather: string, suitable: boolean): string {
    const tips: string[] = [];
    if (temp < 15) tips.push('天气较凉，请给孩子多穿衣服');
    if (temp > 30) tips.push('天气炎热，注意防晒和补水');
    if (weather.includes('雨')) tips.push('有降雨，请携带雨具');
    if (weather.includes('晴')) tips.push('晴天，适合户外活动，注意防晒');
    if (!suitable) tips.push('今日天气不太适合带娃出行，建议改期');
    return tips.join('；') || '天气适宜，适合出行';
  }

  private getMockWeather(lat: number, lng: number, date: string, dayOfWeek: string): WeatherData {
    const dayOfYear = new Date(date).getDate();
    const temp = 18 + (dayOfYear % 10);
    const weathers = ['晴', '多云', '阴', '小雨'];
    const weather = weathers[dayOfYear % 4];
    return {
      date,
      dayOfWeek,
      temp,
      tempMin: temp - 3,
      tempMax: temp + 3,
      weather,
      humidity: 50 + (dayOfYear % 30),
      windSpeed: 2 + (dayOfYear % 5),
      airQuality: '良',
      suitableForKids: temp >= 15 && temp <= 30 && !weather.includes('雨'),
      tips: this.getWeatherTips(temp, weather, temp >= 15 && temp <= 30 && !weather.includes('雨')),
    };
  }
}
