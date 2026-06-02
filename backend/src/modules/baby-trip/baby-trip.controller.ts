import { Controller, Get, Post, Body, Query, Param, Sse, Req } from '@nestjs/common';
import { BabyTripService } from './baby-trip.service';
import { BabyTripRequest } from './baby-trip.types';
import { WeatherService } from '../weather/weather.service';
import { Request } from 'express';
import { Observable, interval } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

@Controller('baby-trip')
export class BabyTripController {
  constructor(
    private readonly babyTripService: BabyTripService,
    private readonly weatherService: WeatherService,
  ) {}

  @Post('execute')
  async execute(@Body() request: BabyTripRequest) {
    return this.babyTripService.execute(request);
  }

  @Get('weather/weekend')
  async getWeekendWeather(@Query('lat') lat: string, @Query('lng') lng: string) {
    const latitude = parseFloat(lat) || parseFloat(process.env.DEFAULT_LATITUDE || '39.9042');
    const longitude = parseFloat(lng) || parseFloat(process.env.DEFAULT_LONGITUDE || '116.4074');
    return this.weatherService.getWeekendWeather(latitude, longitude);
  }

  @Sse('trace/stream/:taskId')
  traceStream(@Param('taskId') taskId: string, @Req() req: Request): Observable<{ data: any }> {
    return interval(1000).pipe(
      switchMap(async () => {
        const trace = await this.babyTripService.getTrace(taskId, (req as any).userId || 'anonymous');
        return trace;
      }),
      map((trace) => {
        if (trace) {
          return { data: { type: 'trace_update', data: trace } };
        }
        return { data: { type: 'waiting' } };
      }),
    );
  }

  @Get('tasks')
  async getTasks(@Query('userId') userId: string, @Query('status') status?: string) {
    return this.babyTripService.getTasks(userId, status);
  }

  @Get('trace/:taskId')
  async getTrace(@Param('taskId') taskId: string, @Query('userId') userId: string) {
    return this.babyTripService.getTrace(taskId, userId);
  }

  @Get('visited')
  async getVisited(@Query('userId') userId: string) {
    return this.babyTripService.getVisitedSpots(userId);
  }

  @Post('visited')
  async markVisited(@Body() body: { userId: string; spotName: string; experience?: string }) {
    return this.babyTripService.markVisited(body.userId, body.spotName, body.experience);
  }
}
