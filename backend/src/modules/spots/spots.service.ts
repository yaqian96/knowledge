import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface SpotInfo {
  name: string;
  address: string;
  lat: number;
  lng: number;
  distance: number;
  category: string;
  rating: number;
  ticketPrice: string;
  description: string;
  ageRange: string;
}

@Injectable()
export class SpotsService {
  private readonly logger = new Logger(SpotsService.name);
  private apiKey: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('AMAP_API_KEY') || '';
  }

  async searchSpots(
    lat: number,
    lng: number,
    radius: number = 10000,
    childAge: number = 5,
    category?: string,
  ): Promise<SpotInfo[]> {
    if (!this.apiKey) {
      return this.getMockSpots(lat, lng, childAge);
    }

    try {
      const types = category || this.getTypesByAge(childAge);
      const res = await axios.get('https://restapi.amap.com/v3/place/around', {
        params: {
          location: `${lng},${lat}`,
          radius,
          types,
          key: this.apiKey,
          offset: 20,
        },
      });

      const pois = res.data.pois || [];
      return pois.map((p: any) => ({
        name: p.name,
        address: p.address,
        lat: parseFloat(p.location.split(',')[1]),
        lng: parseFloat(p.location.split(',')[0]),
        distance: this.calcDistance(lat, lng, parseFloat(p.location.split(',')[1]), parseFloat(p.location.split(',')[0])),
        category: p.type || '景点',
        rating: parseFloat(p.rating || '4.0'),
        ticketPrice: p.price || '免费',
        description: p.address || '',
        ageRange: this.getAgeRange(p.type, childAge),
      }));
    } catch (err) {
      this.logger.warn(`高德地图API调用失败: ${err.message}, 使用模拟数据`);
      return this.getMockSpots(lat, lng, childAge);
    }
  }

  private getTypesByAge(age: number): string {
    if (age <= 3) return '公园|动物园|儿童乐园';
    if (age <= 6) return '公园|动物园|游乐园|科技馆|水族馆';
    return '公园|动物园|游乐园|科技馆|博物馆|植物园';
  }

  private getAgeRange(type: string, age: number): string {
    if (type?.includes('儿童')) return '0-6';
    if (type?.includes('动物园') || type?.includes('游乐园')) return '3-12';
    if (type?.includes('博物馆') || type?.includes('科技馆')) return '6-15';
    return '全年龄';
  }

  private calcDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private getMockSpots(lat: number, lng: number, childAge: number): SpotInfo[] {
    const spots: SpotInfo[] = [
      { name: '市儿童公园', address: '市中心解放路88号', lat: lat + 0.02, lng: lng + 0.01, distance: 2.3, category: '公园', rating: 4.8, ticketPrice: '免费', description: '大型儿童公园，有滑梯、秋千、沙坑', ageRange: '0-12' },
      { name: '市动物园', address: '城郊青山路12号', lat: lat + 0.05, lng: lng - 0.02, distance: 5.1, category: '动物园', rating: 4.5, ticketPrice: '¥80/人', description: '有各种动物，还有儿童互动区', ageRange: '3-12' },
      { name: '科技探索馆', address: '高新区创新大道5号', lat: lat - 0.03, lng: lng + 0.04, distance: 4.2, category: '科技馆', rating: 4.7, ticketPrice: '¥60/人', description: '互动科学实验，适合小朋友探索', ageRange: '6-15' },
      { name: '欢乐谷游乐园', address: '城南欢乐路66号', lat: lat - 0.06, lng: lng - 0.03, distance: 7.8, category: '游乐园', rating: 4.6, ticketPrice: '¥180/人', description: '有适合儿童的旋转木马、小火车等', ageRange: '3-12' },
      { name: '植物园', address: '城北植物园路1号', lat: lat + 0.08, lng: lng + 0.05, distance: 8.5, category: '植物园', rating: 4.4, ticketPrice: '¥30/人', description: '有温室和儿童自然教育区', ageRange: '3-12' },
    ];
    return spots.filter(s => {
      if (childAge <= 3) return s.ageRange.includes('0');
      if (childAge <= 6) return true;
      return !s.ageRange.includes('0-6');
    });
  }
}
