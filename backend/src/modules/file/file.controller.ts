import { Controller, Post, UseInterceptors, UploadedFile, UploadedFiles, Headers } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { FileService } from './file.service';

@Controller('files')
export class FileController {
  constructor(private fileService: FileService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Headers('x-user-id') userId: string,
  ) {
    if (!file) {
      throw new Error('No file uploaded');
    }
    return this.fileService.uploadFile(userId, file);
  }

  @Post('upload/batch')
  @UseInterceptors(FilesInterceptor('files', 20))
  async uploadBatch(
    @UploadedFiles() files: Express.Multer.File[],
    @Headers('x-user-id') userId: string,
  ) {
    if (!files || files.length === 0) {
      throw new Error('No files uploaded');
    }
    const results = [];
    for (const file of files) {
      try {
        const doc = await this.fileService.uploadFile(userId, file);
        results.push({ success: true, filename: doc.filename, id: doc.id });
      } catch (error) {
        results.push({ success: false, filename: file.originalname, error: error.message });
      }
    }
    return { total: files.length, results };
  }
}
