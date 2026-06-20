import { create } from "zustand";
import type {
  CompanyProfile,
  CreateCompanyProfileInput,
  UpdateCompanyProfileInput,
} from "@/types/company";
import { companyRepository } from "@/services/repositories/local/local-company.repository";

interface CompanyState {
  profile: CompanyProfile | null;
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  saveProfile: (input: CreateCompanyProfileInput) => Promise<CompanyProfile>;
  updateProfile: (data: UpdateCompanyProfileInput) => Promise<CompanyProfile>;
  clearProfile: () => Promise<void>;
}

export const useCompanyStore = create<CompanyState>((set, get) => ({
  profile: null,
  isHydrated: false,

  hydrate: async () => {
    const profile = await companyRepository.get();
    set({ profile, isHydrated: true });
  },

  saveProfile: async (input) => {
    const profile = await companyRepository.save(input);
    set({ profile });
    return profile;
  },

  updateProfile: async (data) => {
    const existing = get().profile;
    if (!existing) {
      const profile = await companyRepository.save({
        companyName: data.companyName ?? "",
        logoDataUrl: data.logoDataUrl,
        address: data.address,
        phone: data.phone,
        email: data.email,
        website: data.website,
        trn: data.trn,
        preparedBy: data.preparedBy,
        checkedBy: data.checkedBy,
        defaultNotes: data.defaultNotes,
      });
      set({ profile });
      return profile;
    }
    const profile = await companyRepository.update(data);
    set({ profile });
    return profile;
  },

  clearProfile: async () => {
    await companyRepository.clear();
    set({ profile: null });
  },
}));
