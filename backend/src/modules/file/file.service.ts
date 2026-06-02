import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from '../embedding/embedding.service';
import * as fs from 'fs';
import * as path from 'path';
import * as pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';

@Injectable()
export class FileService {
  constructor(
    private prisma: PrismaService,
    private embeddingService: EmbeddingService,
  ) {}

  async uploadFile(userId: string, file: Express.Multer.File) {
    // Fix Chinese filename encoding: browser sends as latin1, convert to utf8
    const originalFilename = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const fileType = this.getFileType(originalFilename);
    const content = await this.extractContent(file, fileType);
    
    // 使用增强分块策略：递归分块 + 语义边界 + 关键词增强
    const chunks = this.chunkContentEnhanced(content, fileType, originalFilename);
    
    const document = await this.prisma.knowledgeDocument.create({
      data: {
        userId,
        filename: originalFilename,
        fileType,
        filePath: file.path,
        content,
        chunks: JSON.stringify(chunks),
      },
    });

    await this.createDocumentVectors(document.id, chunks);

    return document;
  }

  /**
   * 增强分块策略
   * 1. 递归分块：按文档结构层级逐级细分
   * 2. 语义边界检测：优先在段落/句子边界切分
   * 3. 动态块大小：根据内容密度自动调整
   * 4. 关键词增强：每个块添加文档标题上下文
   */
  private chunkContentEnhanced(content: string, fileType: string, filename: string): any[] {
    const targetSize = this.getTargetChunkSize(fileType, content);
    const chunks: any[] = [];

    // 递归分块入口
    this.recursiveChunk(content, targetSize, 0, chunks, filename);

    return chunks.map((chunk, index) => ({
      index,
      content: chunk,
      metadata: {
        filename,
        fileType,
        charLength: chunk.length,
      },
    }));
  }

  /**
   * 递归分块：按结构层级逐级细分
   * 层级1: 大段落边界 (\n\n\n+)
   * 层级2: 段落边界 (\n\n)
   * 层级3: 句子边界 (.。!！?？)
   * 层级4: 固定大小切分（带重叠）
   */
  private recursiveChunk(
    text: string,
    targetSize: number,
    depth: number,
    chunks: string[],
    filename: string,
  ): void {
    // 文本小于目标大小，直接作为一块
    if (text.length <= targetSize || text.length === 0) {
      if (text.trim()) {
        chunks.push(this.enhanceChunk(text.trim(), filename));
      }
      return;
    }

    // 超过最大递归深度，使用固定大小切分
    if (depth >= 3) {
      this.fixedSizeChunk(text, targetSize, chunks, filename);
      return;
    }

    // 根据深度选择分隔符
    const separators = this.getSeparatorsByDepth(depth);
    let split = false;

    for (const sep of separators) {
      const parts = this.splitBySeparator(text, sep, targetSize);
      if (parts.length > 1) {
        // 成功按语义边界分割
        for (const part of parts) {
          this.recursiveChunk(part, targetSize, depth + 1, chunks, filename);
        }
        split = true;
        break;
      }
    }

    // 如果没有找到合适的分隔符，降级到固定大小切分
    if (!split) {
      this.fixedSizeChunk(text, targetSize, chunks, filename);
    }
  }

  /**
   * 根据递归深度获取分隔符优先级
   */
  private getSeparatorsByDepth(depth: number): string[] {
    switch (depth) {
      case 0:
        // 第一层：大段落/章节分隔
        return ['\n\n\n', '\n\n\n\n'];
      case 1:
        // 第二层：段落分隔
        return ['\n\n', '\n'];
      case 2:
        // 第三层：句子分隔
        return ['。\n', '！\n', '？\n', '。\n', '.\n', '!\n', '?\n'];
      default:
        return [];
    }
  }

  /**
   * 按分隔符分割，确保每块不超过目标大小
   */
  private splitBySeparator(text: string, separator: string, maxSize: number): string[] {
    const parts = text.split(separator);
    const result: string[] = [];
    let currentBlock = '';

    for (const part of parts) {
      const partWithSep = part + separator;
      if ((currentBlock + partWithSep).length <= maxSize || currentBlock === '') {
        currentBlock += partWithSep;
      } else {
        if (currentBlock.trim()) {
          result.push(currentBlock.trim());
        }
        currentBlock = partWithSep;
      }
    }

    if (currentBlock.trim()) {
      result.push(currentBlock.trim());
    }

    return result;
  }

  /**
   * 固定大小切分（最后手段），带重叠保持上下文
   */
  private fixedSizeChunk(text: string, targetSize: number, chunks: string[], filename: string): void {
    const overlap = Math.min(Math.floor(targetSize * 0.1), 150); // 10% 重叠，最多 150 字符
    let i = 0;

    while (i < text.length) {
      let end = Math.min(i + targetSize, text.length);

      // 尝试在句子边界结束
      if (end < text.length) {
        const searchBoundary = text.slice(Math.max(0, end - 200), end + 50);
        const sentenceEnd = searchBoundary.search(/[。！？.!?]/);
        if (sentenceEnd > targetSize * 0.5) {
          end = Math.max(0, end - 200) + sentenceEnd + 1;
        }
      }

      const chunk = text.slice(i, end).trim();
      if (chunk) {
        chunks.push(this.enhanceChunk(chunk, filename));
      }

      i = end - overlap;
      if (i <= 0) i = end; // 防止无限循环
    }
  }

  /**
   * 关键词增强：在块首添加文档标题作为上下文
   */
  private enhanceChunk(content: string, filename: string): string {
    return `[文档: ${filename}]\n${content}`;
  }

  /**
   * 动态块大小：根据文件类型和内容密度调整
   */
  private getTargetChunkSize(fileType: string, content: string): number {
    const baseSize = this.getBaseChunkSize(fileType);

    // 根据内容密度调整
    const lineCount = content.split('\n').length;
    const density = content.length / Math.max(lineCount, 1);

    // 高密度内容（如代码、表格）使用较小块
    if (density > 100) {
      return Math.floor(baseSize * 0.7);
    }

    // 低密度内容（如散文、对话）使用较大块
    if (density < 30) {
      return Math.floor(baseSize * 1.2);
    }

    return baseSize;
  }

  private getBaseChunkSize(fileType: string): number {
    const sizes: Record<string, number> = {
      pdf: 1000,
      excel: 1500,
      image: 800,
      text: 800,
    };
    return sizes[fileType] || 800;
  }

  private async createDocumentVectors(documentId: string, chunks: any[]): Promise<void> {
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      const embedding = await this.embeddingService.getEmbedding(chunk.content);
      
      // Use raw query to properly cast to vector type
      await this.prisma.$executeRaw`
        INSERT INTO "DocumentVector" ("id", "documentId", "chunkIndex", "content", "embedding")
        VALUES (gen_random_uuid(), ${documentId}, ${index}, ${chunk.content}, ${JSON.stringify(embedding)}::vector(1536))
      `;
    }
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
    } catch (error) {
      return `[Image file: ${file.originalname}]`;
    }
  }
}
