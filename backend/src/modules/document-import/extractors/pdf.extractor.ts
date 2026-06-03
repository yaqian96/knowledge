import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as pdfParse from 'pdf-parse';
import { ContentExtractor } from './content-extractor.interface';

@Injectable()
export class PdfExtractor implements ContentExtractor {
  supports(fileType: string): boolean {
    return fileType === 'pdf';
  }

  async extract(file: Express.Multer.File): Promise<string> {
    const dataBuffer = fs.readFileSync(file.path);
    const data = await pdfParse(dataBuffer);
    return data.text;
  }
}
