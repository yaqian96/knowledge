import {
  BadRequestException,
  Controller,
  Headers,
  Post,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { DocumentImportHelper } from '../document-import/document-import.helper';

@Controller('files')
export class FileController {
  constructor(private readonly importHelper: DocumentImportHelper) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Headers('x-user-id') userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const result = await this.importHelper.importFromFile({ userId, file });
    if (!result.success) {
      throw new BadRequestException(result.error ?? '文件上传失败');
    }

    return {
      id: result.documentId,
      filename: result.filename,
    };
  }

  @Post('upload/batch')
  @UseInterceptors(FilesInterceptor('files', 20))
  async uploadBatch(
    @UploadedFiles() files: Express.Multer.File[],
    @Headers('x-user-id') userId: string,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    const batch = await this.importHelper.importBatch(userId, files);

    return {
      total: batch.total,
      succeeded: batch.succeeded,
      failed: batch.failed,
      skipped: batch.skipped,
      results: batch.results.map((r) => ({
        success: r.success,
        filename: r.filename,
        id: r.documentId,
        error: r.error,
        durationMs: r.durationMs,
      })),
    };
  }
}
