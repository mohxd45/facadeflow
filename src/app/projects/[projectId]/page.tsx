"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import Header from "@/components/layout/Header";
import PageContainer from "@/components/layout/PageContainer";
import ProjectDetailTabs from "@/components/projects/ProjectDetailTabs";
import { useProjectStore } from "@/stores/project-store";
import { useDrawingStore } from "@/stores/drawing-store";
import { ChevronLeft } from "lucide-react";

interface ProjectDetailPageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default function ProjectDetailPage({
  params,
  searchParams,
}: ProjectDetailPageProps) {
  const { projectId } = use(params);
  const { tab } = use(searchParams);

  // Select raw store slices — never call methods that return new arrays/objects
  // inside a Zustand selector, as it creates a new reference every render and
  // triggers React's "getSnapshot should be cached" infinite-loop warning.
  const allProjects = useProjectStore((s) => s.projects);
  const allDrawings = useDrawingStore((s) => s.drawings);

  const project = useMemo(
    () => allProjects.find((p) => p.id === projectId),
    [allProjects, projectId]
  );

  const drawings = useMemo(
    () =>
      allDrawings
        .filter((d) => d.projectId === projectId)
        .sort(
          (a, b) =>
            new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
        ),
    [allDrawings, projectId]
  );

  if (!project) {
    notFound();
  }

  return (
    <PageContainer>
      <Link
        href="/projects"
        className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to projects
      </Link>

      <Header
        title={project.name}
        subtitle={
          [project.clientName, project.location].filter(Boolean).join(" · ") ||
          undefined
        }
      />

      <ProjectDetailTabs
        project={project}
        drawings={drawings}
        defaultTab={tab ?? "overview"}
      />
    </PageContainer>
  );
}
