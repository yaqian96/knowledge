import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import { ContentExtractor } from './content-extractor.interface';

@Injectable()
export class TextExtractor implements ContentExtractor {
  supports(): boolean {
    return true;
  }

  async extract(file: Express.Multer.File): Promise<string> {
    return fs.readFileSync(file.path, 'utf-8');
  }
}
