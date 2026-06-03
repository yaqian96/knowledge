import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { ContentExtractor } from './content-extractor.interface';

@Injectable()
export class ExcelExtractor implements ContentExtractor {
  supports(fileType: string): boolean {
    return fileType === 'excel';
  }

  async extract(file: Express.Multer.File): Promise<string> {
    const workbook = XLSX.readFile(file.path);
    const results: string[] = [];

    for (const sheet of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheet];
      const json = XLSX.utils.sheet_to_json(worksheet);
      results.push(`Sheet: ${sheet}\n${JSON.stringify(json, null, 2)}`);
    }

    return results.join('\n\n');
  }
}
