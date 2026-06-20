"use client";

import { useEffect, useMemo, useState } from "react";
import type { Project } from "@/types/project";
import type { DrawingFile } from "@/types/drawing";
import { useProjectStore } from "@/stores/project-store";
import DrawingsTable from "@/components/drawings/DrawingsTable";
import TakeoffTable from "@/components/takeoff/TakeoffTable";
import ProjectOverview from "@/components/projects/ProjectOverview";
import LayerMappingTable from "@/components/layer-mapping/LayerMappingTable";
import AccuracyTab from "@/components/validation/AccuracyTab";
import CodeTakeoffTab from "@/components/code-takeoff/CodeTakeoffTab";
import DrawingTakeoffTab from "@/components/drawing-takeoff/DrawingTakeoffTab";
import DrawingPackageReviewTab from "@/components/projects/DrawingPackageReviewTab";
import { useTakeoffStore } from "@/stores/takeoff-store";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Upload } from "lucide-react";
import type { TakeoffItemFormValues } from "@/components/takeoff/TakeoffItemForm";

interface ProjectDetailTabsProps {
  project: Project;
  drawings: DrawingFile[];
  defaultTab?: string;
}

export default function ProjectDetailTabs({
  project,
  drawings,
  defaultTab = "overview",
}: ProjectDetailTabsProps) {
  const updateProject = useProjectStore((s) => s.updateProject);
  const allItems = useTakeoffStore((s) => s.items);

  // Derive filtered list with useMemo — avoids returning a new array reference
  // from a Zustand selector on every render (infinite-loop warning).
  const items = useMemo(
    () => allItems.filter((i) => i.projectId === project.id),
    [allItems, project.id]
  );
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [notes, setNotes] = useState(project.notes ?? "");
  const [takeoffPrefill, setTakeoffPrefill] = useState<
    Partial<TakeoffItemFormValues> | undefined
  >(undefined);
  const [addTakeoffOpen, setAddTakeoffOpen] = useState(false);

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  const handleSaveNotes = async () => {
    await updateProject(project.id, { notes });
  };

  const handleSendToTakeoff = (drawing: DrawingFile) => {
    setTakeoffPrefill({
      sourceDrawingId: drawing.id,
      drawingViewType: drawing.drawingViewType ?? "plan",
      locationFloor: drawing.floorOrLocation ?? "",
    });
    setActiveTab("takeoff");
    setAddTakeoffOpen(true);
  };

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="package-review" className="font-medium">Package Review</TabsTrigger>
          <TabsTrigger value="drawing-takeoff">Drawing Takeoff</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="code-takeoff">Code Takeoff</TabsTrigger>
          <TabsTrigger value="drawings">Drawings</TabsTrigger>
          <TabsTrigger value="takeoff">Qty Takeoff</TabsTrigger>
          <TabsTrigger value="layers">Layer Mapping</TabsTrigger>
          <TabsTrigger value="accuracy">Accuracy</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>
        <Button asChild size="sm">
          <Link href={`/projects/${project.id}/drawings/upload`}>
            <Upload className="h-4 w-4" />
            Upload Drawing
          </Link>
        </Button>
      </div>

      <TabsContent value="package-review">
        <DrawingPackageReviewTab projectId={project.id} project={project} drawings={drawings} />
      </TabsContent>

      <TabsContent value="drawing-takeoff">
        <DrawingTakeoffTab projectId={project.id} drawings={drawings} />
      </TabsContent>

      <TabsContent value="code-takeoff">
        <CodeTakeoffTab projectId={project.id} drawings={drawings} />
      </TabsContent>

      <TabsContent value="overview">
        <ProjectOverview
          project={project}
          drawingCount={drawings.length}
          takeoffItems={items}
        />
      </TabsContent>

      <TabsContent value="drawings">
        <DrawingsTable
          drawings={drawings}
          projectId={project.id}
          onSendToTakeoff={handleSendToTakeoff}
          onMappingsCreated={() => setActiveTab("layers")}
        />
      </TabsContent>

      <TabsContent value="takeoff">
        <TakeoffTable
          project={project}
          items={items}
          drawings={drawings}
          addDialogOpen={addTakeoffOpen}
          onAddDialogOpenChange={setAddTakeoffOpen}
          addPrefill={takeoffPrefill}
        />
      </TabsContent>

      <TabsContent value="layers">
        <div className="mb-4">
          <h2 className="text-base font-semibold flex items-center gap-2">
            CAD Layer Mapping
            <span className="text-[10px] font-normal bg-slate-100 text-slate-600 rounded px-2 py-0.5">
              DXF verification
            </span>
          </h2>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            Map DXF layer names to takeoff categories for geometry-based verification.
            For the primary takeoff workflow, use the <strong>Code Takeoff</strong> tab.
          </p>
        </div>
        <LayerMappingTable projectId={project.id} />
      </TabsContent>

      <TabsContent value="accuracy">
        <AccuracyTab
          projectId={project.id}
          projectName={project.name}
          systemItems={items}
        />
      </TabsContent>

      <TabsContent value="notes">
        <div className="max-w-2xl space-y-4">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Project notes, site conditions, assumptions…"
            rows={8}
          />
          <Button onClick={handleSaveNotes}>Save notes</Button>
        </div>
      </TabsContent>
    </Tabs>
  );
}
