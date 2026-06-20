export interface CompanyProfile {
  id: string;
  companyName: string;
  logoDataUrl?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  trn?: string;
  preparedBy?: string;
  checkedBy?: string;
  defaultNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export type CreateCompanyProfileInput = Omit<
  CompanyProfile,
  "id" | "createdAt" | "updatedAt"
>;

export type UpdateCompanyProfileInput = Partial<CreateCompanyProfileInput>;
