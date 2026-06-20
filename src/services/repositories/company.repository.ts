import type {
  CompanyProfile,
  CreateCompanyProfileInput,
  UpdateCompanyProfileInput,
} from "@/types/company";

/**
 * Repository boundary for the single company profile.
 * Future: Supabase `company_profiles` table.
 */
export interface ICompanyRepository {
  get(): Promise<CompanyProfile | null>;
  save(input: CreateCompanyProfileInput): Promise<CompanyProfile>;
  update(data: UpdateCompanyProfileInput): Promise<CompanyProfile>;
  clear(): Promise<void>;
}
