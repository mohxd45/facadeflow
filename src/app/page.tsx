"use client";

import { useMemo } from "react";
import Link from "next/link";
import Header from "@/components/layout/Header";
import PageContainer from "@/components/layout/PageContainer";
import StatCard from "@/components/dashboard/StatCard";
import RecentProjects from "@/components/dashboard/RecentProjects";
import CreateProjectDialog from "@/components/projects/CreateProjectDialog";
import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/stores/project-store";
import { useDrawingStore } from "@/stores/drawing-store";
import { useTakeoffStore } from "@/stores/takeoff-store";
import { Upload } from "lucide-react";

export default function DashboardPage() {
  const projects = useProjectStore((s) => s.projects);
  const drawings = useDrawingStore((s) => s.drawings);
  const takeoffItems = useTakeoffStore((s) => s.items);

  // Derive slices with useMemo — never call store methods that return new
  // arrays/objects directly inside a selector; that triggers the React
  // "getSnapshot should be cached" infinite-loop warning.
  const recentProjects = useMemo(() => projects.slice(0, 5), [projects]);
  const firstProjectId = projects[0]?.id;

  return (
    <PageContainer>
      <Header
        title="Dashboard"
        subtitle="Façade quantity takeoff — upload drawings and extract items"
        action={
          <div className="flex gap-2">
            {firstProjectId ? (
              <Button asChild variant="outline">
                <Link href={`/projects/${firstProjectId}/drawings/upload`}>
                  <Upload className="h-4 w-4" />
                  Upload Drawing
                </Link>
              </Button>
            ) : null}
            <CreateProjectDialog />
          </div>
        }
      />

      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Projects"
            value={projects.length}
            subtext="Active takeoff projects"
          />
          <StatCard
            label="Drawings"
            value={drawings.length}
            subtext="Uploaded files"
          />
          <StatCard
            label="Takeoff Items"
            value={takeoffItems.length}
            subtext="Quantity line items"
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RecentProjects projects={recentProjects} />
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-[var(--foreground)]">
              Quick Actions
            </h3>
            <div className="mt-4 space-y-2">
              <CreateProjectDialog
                trigger={
                  <Button className="w-full justify-center">
                    Create Project
                  </Button>
                }
              />
              {firstProjectId ? (
                <Button
                  asChild
                  variant="outline"
                  className="w-full justify-center"
                >
                  <Link href={`/projects/${firstProjectId}/drawings/upload`}>
                    Upload Drawing
                  </Link>
                </Button>
              ) : null}
              <Button
                asChild
                variant="outline"
                className="w-full justify-center"
              >
                <Link href="/projects">View All Projects</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
