import { STORAGE_KEYS } from "@/lib/constants";
import { readJson, writeJson } from "@/lib/storage";
import { generateId } from "@/lib/utils";
import type {
  CompanyProfile,
  CreateCompanyProfileInput,
  UpdateCompanyProfileInput,
} from "@/types/company";
import type { ICompanyRepository } from "../company.repository";

export class LocalCompanyRepository implements ICompanyRepository {
  private load(): CompanyProfile | null {
    return readJson<CompanyProfile | null>(STORAGE_KEYS.companyProfile, null);
  }

  private saveProfile(profile: CompanyProfile | null): void {
    if (profile) {
      writeJson(STORAGE_KEYS.companyProfile, profile);
    } else {
      if (typeof window !== "undefined") {
        localStorage.removeItem(STORAGE_KEYS.companyProfile);
      }
    }
  }

  async get(): Promise<CompanyProfile | null> {
    return this.load();
  }

  async save(input: CreateCompanyProfileInput): Promise<CompanyProfile> {
    const now = new Date().toISOString();
    const profile: CompanyProfile = {
      ...input,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    this.saveProfile(profile);
    return profile;
  }

  async update(data: UpdateCompanyProfileInput): Promise<CompanyProfile> {
    const existing = this.load();
    if (!existing) {
      throw new Error("No company profile exists. Create one first.");
    }
    const updated: CompanyProfile = {
      ...existing,
      ...data,
      updatedAt: new Date().toISOString(),
    };
    this.saveProfile(updated);
    return updated;
  }

  async clear(): Promise<void> {
    this.saveProfile(null);
  }
}

export const companyRepository = new LocalCompanyRepository();
