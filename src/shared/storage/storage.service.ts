import { BadRequestException, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class StorageService {
  private readonly root = path.resolve(process.cwd(), 'storage');

  resolveAbsPath(relativePath: string): string {
    const absPath = path.resolve(process.cwd(), relativePath);
    this.assertInsideStorage(absPath);
    return absPath;
  }

  async moveFile(
    tmpPath: string,
    folder: string,
    country: string,
    fileName: string,
  ): Promise<string> {
    const safeFolder = this.safeSegment(folder, 'folder');
    const safeCountry = this.safeSegment(country, 'country');
    const safeFileName = path.basename(fileName);
    const dir = path.join(this.root, safeFolder, safeCountry);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const finalPath = path.resolve(dir, safeFileName);
    this.assertInsideStorage(finalPath);

    fs.copyFileSync(tmpPath, finalPath);
    fs.unlinkSync(tmpPath);

    return path.relative(process.cwd(), finalPath);
  }

  private safeSegment(value: string, label: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
      throw new BadRequestException(`Invalid storage ${label}`);
    }
    return value;
  }

  private assertInsideStorage(absPath: string) {
    const relative = path.relative(this.root, absPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new BadRequestException('Invalid storage path');
    }
  }
}
