export type Role = "admin" | "member";

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  is_super_admin: boolean;
};

export type Workspace = {
  id: string;
  name: string;
};

export type Membership = {
  workspace_id: string;
  user_id: string;
  role: Role;
  workspaces?: Workspace;
  profiles?: Profile;
};

export type Project = {
  id: string;
  workspace_id: string;
  name: string;
  archived: boolean;
};

export type Task = {
  id: string;
  workspace_id: string;
  project_id: string;
  title: string;
  description: string;
  assignee_id: string | null;
  due_date: string | null;
  completed_at: string | null;
  created_by: string;
  created_at: string;
  projects?: { name: string };
};

export type TimeEntry = {
  id: string;
  workspace_id: string;
  task_id: string;
  user_id: string;
  started_at: string;
  stopped_at: string | null;
  tasks?: { title: string; workspace_id?: string; project_id?: string; projects?: { name: string } };
  profiles?: { full_name: string; email: string };
};
