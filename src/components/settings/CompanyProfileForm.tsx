"use client";

import { useEffect, useRef, useState } from "react";
import type { CompanyProfile } from "@/types/company";
import { useCompanyStore } from "@/stores/company-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Building2, ImagePlus, Trash2 } from "lucide-react";

const ACCEPTED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_LOGO_BYTES = 500 * 1024; // 500 KB

interface FormState {
  companyName: string;
  logoDataUrl?: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  trn: string;
  preparedBy: string;
  checkedBy: string;
  defaultNotes: string;
}

function profileToForm(profile: CompanyProfile | null): FormState {
  return {
    companyName: profile?.companyName ?? "",
    logoDataUrl: profile?.logoDataUrl,
    address: profile?.address ?? "",
    phone: profile?.phone ?? "",
    email: profile?.email ?? "",
    website: profile?.website ?? "",
    trn: profile?.trn ?? "",
    preparedBy: profile?.preparedBy ?? "",
    checkedBy: profile?.checkedBy ?? "",
    defaultNotes: profile?.defaultNotes ?? "",
  };
}

export default function CompanyProfileForm() {
  const profile = useCompanyStore((s) => s.profile);
  const updateProfile = useCompanyStore((s) => s.updateProfile);
  const clearProfile = useCompanyStore((s) => s.clearProfile);

  const [form, setForm] = useState<FormState>(() => profileToForm(profile));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setForm(profileToForm(profile));
  }, [profile]);

  const patch = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoError(null);

    if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
      setLogoError("Logo must be PNG, JPG, or WebP.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError("Logo must be under 500 KB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      patch("logoDataUrl", reader.result as string);
    };
    reader.onerror = () => setLogoError("Failed to read logo file.");
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleRemoveLogo = () => {
    patch("logoDataUrl", undefined);
    setLogoError(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.companyName.trim()) return;

    setSaving(true);
    try {
      await updateProfile({
        companyName: form.companyName.trim(),
        logoDataUrl: form.logoDataUrl,
        address: form.address.trim() || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        website: form.website.trim() || undefined,
        trn: form.trn.trim() || undefined,
        preparedBy: form.preparedBy.trim() || undefined,
        checkedBy: form.checkedBy.trim() || undefined,
        defaultNotes: form.defaultNotes.trim() || undefined,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (
      !window.confirm(
        "Remove the company profile? Exported reports will use the default Facade Takeoff branding."
      )
    ) {
      return;
    }
    await clearProfile();
    setForm(profileToForm(null));
    setSaved(false);
  };

  return (
    <form onSubmit={handleSave} className="space-y-5">
      {/* Logo */}
      <div>
        <label className="mb-2 block text-xs font-medium text-[var(--muted)]">
          Company logo
        </label>
        <div className="flex items-start gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-[var(--border)] bg-slate-50">
            {form.logoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={form.logoDataUrl}
                alt="Company logo preview"
                className="h-full w-full object-contain"
              />
            ) : (
              <Building2 className="h-8 w-8 text-slate-300" />
            )}
          </div>
          <div className="flex flex-col gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleLogoSelect}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4" />
              Upload logo
            </Button>
            {form.logoDataUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-red-600 hover:text-red-700"
                onClick={handleRemoveLogo}
              >
                <Trash2 className="h-4 w-4" />
                Remove logo
              </Button>
            )}
            <p className="text-xs text-[var(--muted)]">
              PNG, JPG, or WebP. Max 500 KB.
            </p>
            {logoError && (
              <p className="text-xs text-red-600">{logoError}</p>
            )}
          </div>
        </div>
      </div>

      {/* Fields */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
            Company name <span className="text-red-500">*</span>
          </label>
          <Input
            value={form.companyName}
            onChange={(e) => patch("companyName", e.target.value)}
            placeholder="e.g. Acme Facade Contracting LLC"
            required
          />
        </div>

        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
            Address
          </label>
          <Textarea
            value={form.address}
            onChange={(e) => patch("address", e.target.value)}
            placeholder="Office address"
            rows={2}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
            Phone
          </label>
          <Input
            value={form.phone}
            onChange={(e) => patch("phone", e.target.value)}
            placeholder="+971 4 xxx xxxx"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
            Email
          </label>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => patch("email", e.target.value)}
            placeholder="estimating@company.com"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
            Website
          </label>
          <Input
            value={form.website}
            onChange={(e) => patch("website", e.target.value)}
            placeholder="https://www.company.com"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
            TRN / VAT No.
          </label>
          <Input
            value={form.trn}
            onChange={(e) => patch("trn", e.target.value)}
            placeholder="Tax registration number"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
            Prepared by
          </label>
          <Input
            value={form.preparedBy}
            onChange={(e) => patch("preparedBy", e.target.value)}
            placeholder="Estimator name"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
            Checked by
          </label>
          <Input
            value={form.checkedBy}
            onChange={(e) => patch("checkedBy", e.target.value)}
            placeholder="Reviewer name"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
            Default notes
          </label>
          <Textarea
            value={form.defaultNotes}
            onChange={(e) => patch("defaultNotes", e.target.value)}
            placeholder="Standard disclaimer or notes shown on exports"
            rows={3}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-4">
        <Button type="submit" size="sm" disabled={saving || !form.companyName.trim()}>
          {saving ? "Saving…" : "Save company profile"}
        </Button>
        {profile && (
          <Button type="button" variant="outline" size="sm" onClick={handleClear}>
            Clear profile
          </Button>
        )}
        {saved && (
          <span className="text-sm text-emerald-600">Profile saved.</span>
        )}
      </div>
    </form>
  );
}
