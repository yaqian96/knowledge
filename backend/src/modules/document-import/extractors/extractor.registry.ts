import { Injectable } from '@nestjs/common';
import { ExtractedContent } from '../document-import.types';
import { getFileType } from '../utils/file-type.util';
import { ContentExtractor } from './content-extractor.interface';
import { PdfExtractor } from './pdf.extractor';
import { ExcelExtractor } from './excel.extractor';
import { ImageExtractor } from './image.extractor';
import { TextExtractor } from './text.extractor';

@Injectable()
export class ExtractorRegistry {
  private readonly extractors: ContentExtractor[];

  constructor(
    pdfExtractor: PdfExtractor,
    excelExtractor: ExcelExtractor,
    imageExtractor: ImageExtractor,
    textExtractor: TextExtractor,
  ) {
    this.extractors = [pdfExtractor, excelExtractor, imageExtractor, textExtractor];
  }

  async extract(
    file: Express.Multer.File,
    fileType?: string,
  ): Promise<ExtractedContent> {
    const resolvedType = fileType ?? getFileType(file.originalname);
    const extractor =
      this.extractors.find((e) => e.supports(resolvedType)) ??
      this.extractors[this.extractors.length - 1];

    const content = await extractor.extract(file);
    return { content, fileType: resolvedType };
  }
}
