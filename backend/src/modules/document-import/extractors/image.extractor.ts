import { Injectable } from '@nestjs/common';
import { ContentExtractor } from './content-extractor.interface';
import { fixFilenameEncoding } from '../utils/file-type.util';

@Injectable()
export class ImageExtractor implements ContentExtractor {
  supports(fileType: string): boolean {
    return fileType === 'image';
  }

  async extract(file: Express.Multer.File): Promise<string> {
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('chi_sim+eng');
      const {
        data: { text },
      } = await worker.recognize(file.path);
      await worker.terminate();
      return text;
    } catch {
      return `[Image file: ${fixFilenameEncoding(file.originalname)}]`;
    }
  }
}
