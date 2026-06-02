import axios from 'axios';
import { API_BASE } from '../config';

const babyTripApi = axios.create({
  baseURL: `${API_BASE}/baby-trip`,
});

export interface BabyTripRequest {
  userId: string;
  message: string;
  lat?: number;
  lng?: number;
  childAge?: number;
  emailTo?: string;
}

export interface BabyTripResponse {
  success: boolean;
  message: string;
  data?: {
    taskId: string;
    weather: any;
    spots: any[];
    plan: any;
    emailSent: boolean;
    totalDuration: number;
  };
  traceId?: string;
}

export interface TraceRecord {
  id: string;
  taskId: string;
  userId: string;
  reasoningSteps: any[];
  toolCalls: any[];
  finalOutput?: string;
  startedAt: string;
  completedAt?: string;
  totalDuration?: number;
}

export const executeBabyTrip = (request: BabyTripRequest) =>
  babyTripApi.post<BabyTripResponse>('/execute', request);

export const getTasks = (userId: string, status?: string) =>
  babyTripApi.get('/tasks', { params: { userId, status } });

export const getTrace = (taskId: string, userId: string) =>
  babyTripApi.get<TraceRecord>(`/trace/${taskId}`, { params: { userId } });

export const getVisitedSpots = (userId: string) =>
  babyTripApi.get('/visited', { params: { userId } });

export const markVisited = (userId: string, spotName: string, experience?: string) =>
  babyTripApi.post('/visited', { userId, spotName, experience });
