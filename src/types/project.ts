export type ProjectStatus = "active" | "archived";

export interface Project {
  id: string;
  name: string;
  clientName?: string;
  location?: string;
  description?: string;
  notes?: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export type CreateProjectInput = Pick<
  Project,
  "name" | "clientName" | "location" | "description"
>;
