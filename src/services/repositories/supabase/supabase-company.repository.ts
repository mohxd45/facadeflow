import { getSupabaseClient } from "@/services/supabase/client";
import type {
  CompanyProfile,
  CreateCompanyProfileInput,
  UpdateCompanyProfileInput,
} from "@/types/company";
import type { ICompanyRepository } from "../company.repository";
import { companyFromDB, companyToDB, companyUpdateToDB } from "./supabase-mappers";

const TABLE = "company_profiles";

export class SupabaseCompanyRepository implements ICompanyRepository {
  /** Fetch the single company profile (takes the first row found). */
  async get(): Promise<CompanyProfile | null> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .select("*")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`[company_profiles] get: ${error.message}`);
    return data ? companyFromDB(data) : null;
  }

  async save(input: CreateCompanyProfileInput): Promise<CompanyProfile> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .insert(companyToDB(input))
      .select()
      .single();
    if (error) throw new Error(`[company_profiles] save: ${error.message}`);
    return companyFromDB(data);
  }

  async update(payload: UpdateCompanyProfileInput): Promise<CompanyProfile> {
    const existing = await this.get();
    if (!existing) {
      // No row yet — create one from the partial data
      return this.save({
        companyName: payload.companyName ?? "",
        ...payload,
      } as CreateCompanyProfileInput);
    }
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .update(companyUpdateToDB(payload))
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw new Error(`[company_profiles] update: ${error.message}`);
    return companyFromDB(data);
  }

  async clear(): Promise<void> {
    const existing = await this.get();
    if (!existing) return;
    const { error } = await getSupabaseClient()
      .from(TABLE)
      .delete()
      .eq("id", existing.id);
    if (error) throw new Error(`[company_profiles] clear: ${error.message}`);
  }
}
