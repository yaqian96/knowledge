export interface ContentExtractor {
  supports(fileType: string): boolean;
  extract(file: Express.Multer.File): Promise<string>;
}
