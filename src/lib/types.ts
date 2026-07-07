export type Role = "admin" | "member";

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  is_super_admin: boolean;
  /** 1–3 písmena; prázdné = odvodit ze jména */
  avatar_initials?: string;
  /** #rrggbb; prázdné = odvodit z id */
  avatar_color?: string;
  /** @handle bez zavináče, unikátní; nastavuje admin */
  tag_name?: string;
};

export type Workspace = {
  id: string;
  name: string;
};

export type Membership = {
  workspace_id: string;
  user_id: string;
  role: Role;
  /** per-firma notifikační e-mail; prázdný = účetní e-mail. Nastavuje admin. */
  notify_email?: string;
  workspaces?: Workspace;
  profiles?: Profile;
};

export type Project = {
  id: string;
  workspace_id: string;
  name: string;
  archived: boolean;
  position: number;
};

export type BoardColumn = {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  position: number;
};

export type Recurrence = "daily" | "weekdays" | "weekly" | "monthly" | "yearly";

export type Task = {
  id: string;
  workspace_id: string;
  project_id: string;
  column_id: string | null;
  position: number;
  title: string;
  description: string;
  /** legacy — řešitele nese tabulka task_assignees */
  assignee_id: string | null;
  due_date: string | null;
  completed_at: string | null;
  created_by: string;
  created_at: string;
  priority: number;
  parent_id: string | null;
  recurrence: Recurrence | null;
  projects?: { name: string; position?: number };
  board_columns?: { name: string } | null;
};

export type Label = {
  id: string;
  workspace_id: string;
  name: string;
};

export type AppNotification = {
  id: string;
  user_id: string;
  kind: "assigned" | "comment" | "mention";
  workspace_id: string;
  project_id: string | null;
  task_id: string | null;
  task_title: string;
  actor_name: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

export type NotificationPrefs = {
  user_id: string;
  on_assign: boolean;
  on_comment: boolean;
  on_mention: boolean;
  daily_digest: boolean;
};

export type TaskComment = {
  id: string;
  workspace_id: string;
  task_id: string;
  author_id: string;
  body: string;
  created_at: string;
  profiles?: { full_name: string; email: string };
};

export type TimeEntry = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  task_id: string | null;
  user_id: string;
  description: string;
  started_at: string;
  stopped_at: string | null;
  tasks?: { title: string } | null;
  projects?: { name: string; position?: number } | null;
  profiles?: {
    full_name: string;
    email: string;
    avatar_initials?: string;
    avatar_color?: string;
  };
};
