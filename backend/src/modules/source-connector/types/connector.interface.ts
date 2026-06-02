import { SourceAccount } from '@prisma/client';

export type SourceProvider = 'youdao' | 'feishu' | 'upload';

export interface ConnectorCapabilities {
  oauth: boolean;
  manualCredential: boolean;
  listTargets: boolean;
  incremental: boolean;
}

export interface RemoteTarget {
  externalId: string;
  title: string;
  parentId?: string;
  mimeType?: string;
  modifiedAt?: Date;
  url?: string;
  isFolder?: boolean;
}

export interface FetchedDocument {
  externalId: string;
  title: string;
  content: string;
  contentHash: string;
  externalUrl?: string;
  mimeType?: string;
}

export interface CredentialPayload {
  [key: string]: string | number | undefined;
}

export interface DocumentConnector {
  readonly provider: SourceProvider;
  readonly capabilities: ConnectorCapabilities;

  listTargets(account: SourceAccount, parentId?: string): Promise<RemoteTarget[]>;
  fetchDocument(account: SourceAccount, target: RemoteTarget): Promise<FetchedDocument>;
  listAllNotes?(account: SourceAccount): Promise<RemoteTarget[]>;
}
