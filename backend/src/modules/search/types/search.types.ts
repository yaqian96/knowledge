export interface ChunkIndexDoc {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  userId: string;
  filename: string;
  content: string;
  fileType: string;
  sourceProvider: string;
  createdAt?: string;
}

export interface RankedChunk {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  filename: string;
  content: string;
  sourceProvider: string;
  rrfScore?: number;
  rerankScore?: number;
}

export interface SearchOptions {
  limit?: number;
  skipRerank?: boolean;
}
