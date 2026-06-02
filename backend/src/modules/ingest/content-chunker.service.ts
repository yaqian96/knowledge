import { Injectable } from '@nestjs/common';

export interface ContentChunk {
  index: number;
  content: string;
  metadata: {
    filename: string;
    fileType: string;
    charLength: number;
  };
}

@Injectable()
export class ContentChunkerService {
  chunk(
    content: string,
    fileType: string,
    filename: string,
    maxChunks = 40,
  ): ContentChunk[] {
    const safeContent = content.length > 100_000 ? content.slice(0, 100_000) : content;
    const targetSize = this.getTargetChunkSize(fileType, safeContent);
    const chunks: string[] = [];
    this.recursiveChunk(safeContent, targetSize, 0, chunks, filename, maxChunks);

    return chunks.slice(0, maxChunks).map((chunk, index) => ({
      index,
      content: chunk,
      metadata: {
        filename,
        fileType,
        charLength: chunk.length,
      },
    }));
  }

  private recursiveChunk(
    text: string,
    targetSize: number,
    depth: number,
    chunks: string[],
    filename: string,
    maxChunks: number,
  ): void {
    if (chunks.length >= maxChunks) return;

    if (text.length <= targetSize || text.length === 0) {
      if (text.trim() && chunks.length < maxChunks) {
        chunks.push(this.enhanceChunk(text.trim(), filename));
      }
      return;
    }

    if (depth >= 3) {
      this.fixedSizeChunk(text, targetSize, chunks, filename, maxChunks);
      return;
    }

    const separators = this.getSeparatorsByDepth(depth);
    let split = false;

    for (const sep of separators) {
      const parts = this.splitBySeparator(text, sep, targetSize);
      if (parts.length > 1) {
        for (const part of parts) {
          if (chunks.length >= maxChunks) return;
          this.recursiveChunk(part, targetSize, depth + 1, chunks, filename, maxChunks);
        }
        split = true;
        break;
      }
    }

    if (!split) {
      this.fixedSizeChunk(text, targetSize, chunks, filename, maxChunks);
    }
  }

  private getSeparatorsByDepth(depth: number): string[] {
    switch (depth) {
      case 0:
        return ['\n\n\n', '\n\n\n\n'];
      case 1:
        return ['\n\n', '\n'];
      case 2:
        return ['。\n', '！\n', '？\n', '.\n', '!\n', '?\n'];
      default:
        return [];
    }
  }

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

  private fixedSizeChunk(
    text: string,
    targetSize: number,
    chunks: string[],
    filename: string,
    maxChunks: number,
  ): void {
    const overlap = Math.min(Math.floor(targetSize * 0.1), 150);
    let i = 0;

    while (i < text.length && chunks.length < maxChunks) {
      let end = Math.min(i + targetSize, text.length);

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
      if (i <= 0) i = end;
    }
  }

  private enhanceChunk(content: string, filename: string): string {
    return `[文档: ${filename}]\n${content}`;
  }

  private getTargetChunkSize(fileType: string, content: string): number {
    const baseSize = this.getBaseChunkSize(fileType);
    const lineCount = content.split('\n').length;
    const density = content.length / Math.max(lineCount, 1);

    if (density > 100) {
      return Math.floor(baseSize * 0.7);
    }
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
      markdown: 800,
    };
    return sizes[fileType] || 800;
  }
}
