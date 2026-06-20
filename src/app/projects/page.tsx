"use client";

import Link from "next/link";
import Header from "@/components/layout/Header";
import PageContainer from "@/components/layout/PageContainer";
import CreateProjectDialog from "@/components/projects/CreateProjectDialog";
import { useProjectStore } from "@/stores/project-store";
import { formatDate } from "@/lib/utils";
import { FolderOpen } from "lucide-react";

export default function ProjectsPage() {
  const projects = useProjectStore((s) => s.projects);

  return (
    <PageContainer>
      <Header
        title="Projects"
        subtitle="Manage façade takeoff projects"
        action={<CreateProjectDialog />}
      />

      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border)] py-16 text-center">
          <FolderOpen className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-medium">No projects yet</p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Create a project to start uploading drawings.
          </p>
          <div className="mt-4">
            <CreateProjectDialog />
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-slate-50">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                  Project
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                  Client
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                  Location
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                  Updated
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr
                  key={project.id}
                  className="border-b border-[var(--border)] transition-colors hover:bg-slate-50"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/projects/${project.id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {project.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">
                    {project.clientName ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">
                    {project.location ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">
                    {formatDate(project.updatedAt)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium capitalize text-green-800">
                      {project.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageContainer>
  );
}
