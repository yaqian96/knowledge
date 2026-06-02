import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WeatherService } from '../weather/weather.service';
import { SpotsService } from '../spots/spots.service';
import { EmailService } from '../email/email.service';
import { BabyTripController } from './baby-trip.controller';
import { BabyTripService } from './baby-trip.service';

@Module({
  imports: [PrismaModule],
  controllers: [BabyTripController],
  providers: [BabyTripService, WeatherService, SpotsService, EmailService],
  exports: [BabyTripService, WeatherService, SpotsService, EmailService],
})
export class BabyTripModule {}
