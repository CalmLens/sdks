import type { Asset } from "../client/CalmLensTypes";
import type { AssetBinaryPayloadInput } from "../contract/AssetPayload.js";
import {
  assetDataToUint8Array,
  assetToData,
  validateAssetPayload,
} from "../contract/AssetPayload.js";
import type { Folder } from "../contract/Folder.js";

export interface MockStoredContent {
  assetId: string;
  parts: Map<number, Uint8Array>;
  type?: string;
}

export interface MockImageStorage {
  putContent(assetId: string, content: AssetBinaryPayloadInput & { type: string }): Promise<void>;
  putPart(
    assetId: string,
    part: AssetBinaryPayloadInput & { type?: string; partNumber?: number; isFinal?: boolean },
  ): Promise<void>;
  getContent(assetId: string): Promise<MockStoredContent | undefined>;
  deleteContent(assetId: string): Promise<void>;
}

export class InMemoryMockImageStorage implements MockImageStorage {
  private readonly content = new Map<string, MockStoredContent>();

  async putContent(
    assetId: string,
    content: AssetBinaryPayloadInput & { type: string },
  ): Promise<void> {
    const validation = validateAssetPayload(content);
    if (!validation.ok) {
      throw new Error(validation.error);
    }
    const bytes = await assetDataToUint8Array(assetToData(content));
    this.content.set(assetId, {
      assetId,
      parts: new Map([[1, bytes]]),
      type: content.type,
    });
  }

  async putPart(
    assetId: string,
    part: AssetBinaryPayloadInput & { type?: string; partNumber?: number; isFinal?: boolean },
  ): Promise<void> {
    const validation = validateAssetPayload(part, {
      multipart: true,
      isFinal: part.isFinal,
    });
    if (!validation.ok) {
      throw new Error(validation.error);
    }
    const bytes = await assetDataToUint8Array(assetToData(part));
    const existing = this.content.get(assetId) ?? {
      assetId,
      parts: new Map<number, Uint8Array>(),
      type: part.type,
    };
    existing.parts.set(part.partNumber ?? 1, bytes);
    existing.type = part.type ?? existing.type;
    this.content.set(assetId, existing);
  }

  async getContent(assetId: string): Promise<MockStoredContent | undefined> {
    return this.content.get(assetId);
  }

  async deleteContent(assetId: string): Promise<void> {
    this.content.delete(assetId);
  }
}

export interface MockDatabaseStorage {
  createAsset(asset: Asset): Promise<Asset>;
  updateAsset(asset: Asset): Promise<Asset>;
  getAsset(assetId: string): Promise<Asset | undefined>;
  listAssets(projectId: string): Promise<Asset[]>;
  deleteAsset(assetId: string): Promise<void>;
  createFolder?(folder: Folder): Promise<Folder>;
  updateFolder?(folder: Folder): Promise<Folder>;
  getFolder?(folderId: string): Promise<Folder | undefined>;
  listFolders?(projectId: string): Promise<Folder[]>;
  deleteFolder?(folderId: string): Promise<void>;
}

export class InMemoryMockDatabaseStorage implements MockDatabaseStorage {
  private readonly assets = new Map<string, Asset>();
  private readonly folders = new Map<string, Folder>();

  async createAsset(asset: Asset): Promise<Asset> {
    this.assets.set(asset.id, asset);
    return asset;
  }

  async updateAsset(asset: Asset): Promise<Asset> {
    this.assets.set(asset.id, asset);
    return asset;
  }

  async getAsset(assetId: string): Promise<Asset | undefined> {
    return this.assets.get(assetId);
  }

  async listAssets(projectId: string): Promise<Asset[]> {
    return [...this.assets.values()].filter((asset) => asset.projectId === projectId);
  }

  async deleteAsset(assetId: string): Promise<void> {
    this.assets.delete(assetId);
  }

  async createFolder(folder: Folder): Promise<Folder> {
    this.folders.set(folder.id, folder);
    return folder;
  }

  async updateFolder(folder: Folder): Promise<Folder> {
    this.folders.set(folder.id, folder);
    return folder;
  }

  async getFolder(folderId: string): Promise<Folder | undefined> {
    return this.folders.get(folderId);
  }

  async listFolders(projectId: string): Promise<Folder[]> {
    return [...this.folders.values()]
      .filter((folder) => folder.projectId === projectId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async deleteFolder(folderId: string): Promise<void> {
    this.folders.delete(folderId);
  }
}
