"use client";

import Link from "next/link";
import type { Project } from "@/types/project";
import { formatDate } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FolderOpen } from "lucide-react";

interface RecentProjectsProps {
  projects: Project[];
}

export default function RecentProjects({ projects }: RecentProjectsProps) {
  if (projects.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Projects</CardTitle>
          <CardDescription>No projects yet</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--muted)]">
            Create your first project to start uploading drawings and building
            quantity takeoffs.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Projects</CardTitle>
        <CardDescription>Your latest takeoff projects</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {projects.map((project) => (
          <Link
            key={project.id}
            href={`/projects/${project.id}`}
            className="flex items-center gap-3 rounded-md border border-[var(--border)] p-3 transition-colors hover:bg-slate-50"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-50 text-blue-600">
              <FolderOpen className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{project.name}</p>
              <p className="text-xs text-[var(--muted)]">
                {project.clientName && `${project.clientName} · `}
                Updated {formatDate(project.updatedAt)}
              </p>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
