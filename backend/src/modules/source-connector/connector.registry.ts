import { Injectable, NotFoundException } from '@nestjs/common';
import { DocumentConnector, SourceProvider } from './types/connector.interface';
import { YoudaoCookieConnector } from './providers/youdao/youdao-cookie.connector';

@Injectable()
export class ConnectorRegistry {
  private readonly connectors = new Map<SourceProvider, DocumentConnector>();

  constructor(youdaoConnector: YoudaoCookieConnector) {
    this.register(youdaoConnector);
  }

  register(connector: DocumentConnector) {
    this.connectors.set(connector.provider, connector);
  }

  get(provider: string): DocumentConnector {
    const connector = this.connectors.get(provider as SourceProvider);
    if (!connector) {
      throw new NotFoundException(`不支持的文档源: ${provider}`);
    }
    return connector;
  }

  listProviders() {
    return Array.from(this.connectors.values()).map((c) => ({
      provider: c.provider,
      capabilities: c.capabilities,
    }));
  }
}
