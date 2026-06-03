export type ImportSource = 'upload' | 'youdao' | 'feishu' | 'api';

export interface ImportDocumentInput {
  userId: string;
  title: string;
  content: string;
  source?: ImportSource;
  fileType?: string;
  filePath?: string;
  externalId?: string;
  externalUrl?: string;
  contentHash?: string;
}

export interface ImportFromFileInput {
  userId: string;
  file: Express.Multer.File;
  source?: ImportSource;
}

export interface ImportResult {
  success: boolean;
  documentId?: string;
  filename: string;
  skipped?: boolean;
  error?: string;
  durationMs: number;
}

export interface BatchImportOptions {
  concurrency?: number;
}

export interface BatchImportResult {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: ImportResult[];
}

export interface ExtractedContent {
  content: string;
  fileType: string;
}
