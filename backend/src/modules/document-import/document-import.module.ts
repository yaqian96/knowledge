import { Module } from '@nestjs/common';
import { IngestModule } from '../ingest/ingest.module';
import { DocumentImportHelper } from './document-import.helper';
import { ExtractorRegistry } from './extractors/extractor.registry';
import { PdfExtractor } from './extractors/pdf.extractor';
import { ExcelExtractor } from './extractors/excel.extractor';
import { ImageExtractor } from './extractors/image.extractor';
import { TextExtractor } from './extractors/text.extractor';

@Module({
  imports: [IngestModule],
  providers: [
    PdfExtractor,
    ExcelExtractor,
    ImageExtractor,
    TextExtractor,
    ExtractorRegistry,
    DocumentImportHelper,
  ],
  exports: [DocumentImportHelper],
})
export class DocumentImportModule {}
