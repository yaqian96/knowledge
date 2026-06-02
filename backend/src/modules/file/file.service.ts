import { Injectable } from '@nestjs/common';
import { DocumentIngestService } from '../ingest/document-ingest.service';
import * as fs from 'fs';
import * as path from 'path';
import * as pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';

@Injectable()
export class FileService {
  constructor(private ingestService: DocumentIngestService) {}

  async uploadFile(userId: string, file: Express.Multer.File) {
    const originalFilename = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const fileType = this.getFileType(originalFilename);
    const content = await this.extractContent(file, fileType);

    return this.ingestService.ingest({
      userId,
      title: originalFilename,
      content,
      sourceProvider: 'upload',
      fileType,
      filePath: file.path,
    });
  }

  private getFileType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const typeMap: Record<string, string> = {
      '.pdf': 'pdf',
      '.xlsx': 'excel',
      '.xls': 'excel',
      '.csv': 'excel',
      '.png': 'image',
      '.jpg': 'image',
      '.jpeg': 'image',
      '.gif': 'image',
      '.webp': 'image',
    };
    return typeMap[ext] || 'text';
  }

  private async extractContent(file: Express.Multer.File, fileType: string): Promise<string> {
    switch (fileType) {
      case 'pdf':
        return this.extractPDF(file);
      case 'excel':
        return this.extractExcel(file);
      case 'image':
        return await this.extractImageText(file);
      default:
        return fs.readFileSync(file.path, 'utf-8');
    }
  }

  private async extractPDF(file: Express.Multer.File): Promise<string> {
    const dataBuffer = fs.readFileSync(file.path);
    const data = await pdfParse(dataBuffer);
    return data.text;
  }

  private extractExcel(file: Express.Multer.File): string {
    const workbook = XLSX.readFile(file.path);
    const sheets = workbook.SheetNames;
    const results: string[] = [];

    for (const sheet of sheets) {
      const worksheet = workbook.Sheets[sheet];
      const json = XLSX.utils.sheet_to_json(worksheet);
      results.push(`Sheet: ${sheet}\n${JSON.stringify(json, null, 2)}`);
    }

    return results.join('\n\n');
  }

  private async extractImageText(file: Express.Multer.File): Promise<string> {
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('chi_sim+eng');
      const { data: { text } } = await worker.recognize(file.path);
      await worker.terminate();
      return text;
    } catch {
      return `[Image file: ${file.originalname}]`;
    }
  }
}
