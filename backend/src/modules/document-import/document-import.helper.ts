import { Injectable, Logger } from '@nestjs/common';
import { DocumentIngestService } from '../ingest/document-ingest.service';
import {
  BatchImportOptions,
  BatchImportResult,
  ImportDocumentInput,
  ImportFromFileInput,
  ImportResult,
} from './document-import.types';
import { ExtractorRegistry } from './extractors/extractor.registry';
import { fixFilenameEncoding, getFileType } from './utils/file-type.util';

@Injectable()
export class DocumentImportHelper {
  private readonly logger = new Logger(DocumentImportHelper.name);
  private readonly defaultConcurrency = Number(
    process.env.IMPORT_BATCH_CONCURRENCY ?? 3,
  );

  constructor(
    private readonly extractorRegistry: ExtractorRegistry,
    private readonly ingestService: DocumentIngestService,
  ) {}

  async importDocument(input: ImportDocumentInput): Promise<ImportResult> {
    const start = Date.now();
    const filename = input.title;

    try {
      if (!input.content?.trim()) {
        return {
          success: false,
          filename,
          error: '文档内容为空',
          durationMs: Date.now() - start,
        };
      }

      const doc = await this.ingestService.ingest({
        userId: input.userId,
        title: input.title,
        content: input.content,
        sourceProvider: input.source ?? 'upload',
        fileType: input.fileType,
        filePath: input.filePath,
        externalId: input.externalId,
        externalUrl: input.externalUrl,
        contentHash: input.contentHash,
      });

      return {
        success: true,
        documentId: doc.id,
        filename,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`importDocument failed (${filename}): ${message}`);
      return {
        success: false,
        filename,
        error: message,
        durationMs: Date.now() - start,
      };
    }
  }

  async importOrUpdate(input: ImportDocumentInput): Promise<ImportResult> {
    const start = Date.now();
    const filename = input.title;

    try {
      if (!input.content?.trim()) {
        return {
          success: false,
          filename,
          error: '文档内容为空',
          durationMs: Date.now() - start,
        };
      }

      const doc = await this.ingestService.upsertByExternalId({
        userId: input.userId,
        title: input.title,
        content: input.content,
        sourceProvider: input.source ?? 'youdao',
        fileType: input.fileType,
        filePath: input.filePath,
        externalId: input.externalId,
        externalUrl: input.externalUrl,
        contentHash: input.contentHash,
      });

      return {
        success: true,
        documentId: doc.id,
        filename,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`importOrUpdate failed (${filename}): ${message}`);
      return {
        success: false,
        filename,
        error: message,
        durationMs: Date.now() - start,
      };
    }
  }

  async importFromFile(input: ImportFromFileInput): Promise<ImportResult> {
    const start = Date.now();
    const filename = fixFilenameEncoding(input.file.originalname);

    try {
      const { content, fileType } = await this.extractorRegistry.extract(
        input.file,
        getFileType(filename),
      );

      if (!content.trim()) {
        return {
          success: false,
          filename,
          error: '解析后内容为空',
          durationMs: Date.now() - start,
        };
      }

      return this.importDocument({
        userId: input.userId,
        title: filename,
        content,
        source: input.source ?? 'upload',
        fileType,
        filePath: input.file.path,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`importFromFile failed (${filename}): ${message}`);
      return {
        success: false,
        filename,
        error: message,
        durationMs: Date.now() - start,
      };
    }
  }

  async importBatch(
    userId: string,
    files: Express.Multer.File[],
    options?: BatchImportOptions,
  ): Promise<BatchImportResult> {
    const concurrency = options?.concurrency ?? this.defaultConcurrency;
    const results = await this.runPool(files, concurrency, (file) =>
      this.importFromFile({ userId, file }),
    );

    return {
      total: files.length,
      succeeded: results.filter((r) => r.success && !r.skipped).length,
      failed: results.filter((r) => !r.success).length,
      skipped: results.filter((r) => r.skipped).length,
      results,
    };
  }

  private async runPool<T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<R>,
  ): Promise<R[]> {
    if (items.length === 0) return [];

    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, items.length);

    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= items.length) break;
        results[index] = await fn(items[index]);
      }
    });

    await Promise.all(workers);
    return results;
  }
}
