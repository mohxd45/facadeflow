"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import Header from "@/components/layout/Header";
import PageContainer from "@/components/layout/PageContainer";
import DrawingUploadForm from "@/components/drawings/DrawingUploadForm";
import ZipPackageUploadPanel from "@/components/projects/ZipPackageUploadPanel";
import { useProjectStore } from "@/stores/project-store";
import { ChevronLeft, Archive, FileUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface UploadPageProps {
  params: Promise<{ projectId: string }>;
}

type UploadMode = "individual" | "zip";

export default function DrawingUploadPage({ params }: UploadPageProps) {
  const { projectId } = use(params);
  const [mode, setMode] = useState<UploadMode>("individual");
  const [zipImportedCount, setZipImportedCount] = useState(0);

  const allProjects = useProjectStore((s) => s.projects);
  const project = useMemo(
    () => allProjects.find((p) => p.id === projectId),
    [allProjects, projectId]
  );

  if (!project) {
    notFound();
  }

  const tabs: Array<{ id: UploadMode; label: string; icon: React.ReactNode; desc: string }> = [
    {
      id: "individual",
      label: "Upload Individual Drawings",
      icon: <FileUp className="h-4 w-4" />,
      desc: "Select one or more PDF, DXF, or DWG files manually.",
    },
    {
      id: "zip",
      label: "Upload Full ZIP Package",
      icon: <Archive className="h-4 w-4" />,
      desc: "Upload the full client ZIP as received. System classifies and imports selected drawings.",
    },
  ];

  return (
    <PageContainer>
      <Link
        href={`/projects/${projectId}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to {project.name}
      </Link>

      <Header
        title="Upload Drawings"
        subtitle="Add drawings individually or upload the full client ZIP package."
      />

      {/* Upload method selector */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setMode(tab.id)}
            className={cn(
              "flex items-start gap-3 rounded-xl border-2 px-4 py-4 text-left transition-colors",
              mode === tab.id
                ? "border-blue-600 bg-blue-50"
                : "border-slate-200 bg-white hover:border-slate-300"
            )}
          >
            <span className={cn("mt-0.5", mode === tab.id ? "text-blue-600" : "text-slate-500")}>
              {tab.icon}
            </span>
            <div>
              <p className={cn("text-sm font-semibold", mode === tab.id ? "text-blue-800" : "text-slate-800")}>
                {tab.label}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">{tab.desc}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Selected mode content */}
      {mode === "individual" && (
        <DrawingUploadForm projectId={projectId} />
      )}

      {mode === "zip" && (
        <div className="space-y-4">
          <ZipPackageUploadPanel
            projectId={projectId}
            onImported={(count) => setZipImportedCount((prev) => prev + count)}
          />
          {zipImportedCount > 0 && (
            <div className="rounded-md bg-green-50 border border-green-200 px-4 py-2.5 text-sm text-green-800">
              <strong>{zipImportedCount}</strong> drawing{zipImportedCount > 1 ? "s" : ""} imported this session.
              <Link
                href={`/projects/${projectId}`}
                className="ml-2 underline text-green-700 hover:text-green-900"
              >
                Open Package Review →
              </Link>
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}
