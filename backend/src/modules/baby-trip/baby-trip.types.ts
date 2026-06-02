export interface ToolCallRecord {
  id: string;
  toolName: string;
  timestamp: string;
  arguments: any;
  result: any;
  attempts: { attemptIndex: number; timestamp: string; arguments: any; success: boolean; result?: any; error?: string }[];
  duration: number;
}

export interface ReasoningStep {
  stepIndex: number;
  timestamp: string;
  type: 'intent_analysis' | 'task_decomposition' | 'tool_selection' | 'result_synthesis';
  content: string;
  metadata?: any;
}

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
  data?: any;
  traceId?: string;
}
