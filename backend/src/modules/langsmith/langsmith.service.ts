import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  flushLangSmithTraces,
  getLangSmithClient,
  getStreamText,
  initLangSmithTracing,
  isLangSmithEnabled,
} from './ai-sdk.tracing';

@Injectable()
export class LangSmithService implements OnModuleInit {
  private readonly logger = new Logger(LangSmithService.name);
  private enabled = false;

  onModuleInit() {
    this.enabled = initLangSmithTracing();
    if (this.enabled) {
      const project =
        process.env.LANGSMITH_PROJECT ||
        process.env.LANGCHAIN_PROJECT ||
        'default';
      this.logger.log(`LangSmith tracing enabled (project: ${project})`);
    } else if (isLangSmithEnabled()) {
      this.logger.warn(
        'LangSmith 配置已开启但初始化失败，请执行 cd backend && npm install',
      );
    } else {
      this.logger.log(
        'LangSmith tracing disabled (set LANGSMITH_TRACING=true and LANGSMITH_API_KEY)',
      );
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getStreamText() {
    return getStreamText();
  }

  getClient() {
    return getLangSmithClient();
  }

  async flush(): Promise<void> {
    await flushLangSmithTraces();
  }

  async wrapRetriever<T extends (...args: never[]) => Promise<unknown>>(
    fn: T,
    name: string,
  ): Promise<T> {
    if (!this.enabled) {
      return fn;
    }
    const { traceable } = await import('langsmith/traceable');
    return traceable(fn, { name, run_type: 'retriever' }) as T;
  }
}
