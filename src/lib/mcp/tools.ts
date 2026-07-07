import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createUserClient } from "./auth";

// Nástroje MCP serveru Toggled. Každý běží pod JWT přihlášeného uživatele
// (createUserClient), takže veškerá autorizace, izolace workspace i role
// zůstává na stávající RLS — tady žádná kontrola oprávnění navíc není.

type Extra = { authInfo?: { extra?: Record<string, unknown> } };

function clientFor(extra: Extra) {
  const userId = extra.authInfo?.extra?.userId as string | undefined;
  if (!userId) throw new Error("Chybí identita uživatele (neplatný token).");
  return { client: createUserClient(userId), userId };
}

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});
const fail = (msg: string) => ({
  content: [{ type: "text" as const, text: msg }],
  isError: true as const,
});

export function registerTools(server: McpServer): void {
  server.registerTool(
    "list_workspaces",
    {
      title: "Seznam workspaces",
      description: "Vrátí workspaces (firmy/týmy), do kterých uživatel patří.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const { client } = clientFor(extra);
      const { data, error } = await client
        .from("workspaces")
        .select("id, name")
        .order("name");
      return error ? fail(error.message) : ok(data);
    }
  );

  server.registerTool(
    "list_projects",
    {
      title: "Seznam projektů",
      description:
        "Aktivní projekty, které uživatel vidí. Volitelně omezí na jeden workspace.",
      inputSchema: {
        workspace_id: z
          .string()
          .optional()
          .describe("volitelně: omezit na jeden workspace"),
      },
    },
    async ({ workspace_id }, extra) => {
      const { client } = clientFor(extra);
      let q = client
        .from("projects")
        .select("id, name, workspace_id")
        .eq("archived", false)
        .order("position");
      if (workspace_id) q = q.eq("workspace_id", workspace_id);
      const { data, error } = await q;
      return error ? fail(error.message) : ok(data);
    }
  );

  server.registerTool(
    "list_project_members",
    {
      title: "Členové projektu",
      description:
        "Lidé, které lze na úkoly projektu přiřadit jako řešitele (nutné před assign_task).",
      inputSchema: { project_id: z.string() },
    },
    async ({ project_id }, extra) => {
      const { client } = clientFor(extra);
      const { data, error } = await client
        .from("project_members")
        .select("user_id, profiles(id, full_name, email, tag_name)")
        .eq("project_id", project_id);
      return error ? fail(error.message) : ok(data);
    }
  );

  server.registerTool(
    "create_task",
    {
      title: "Založit úkol",
      description:
        "Vytvoří úkol v projektu pod jménem uživatele. Volitelně rovnou přiřadí řešitele (musí být členové projektu).",
      inputSchema: {
        project_id: z.string(),
        title: z.string(),
        description: z.string().optional(),
        due_date: z.string().optional().describe("termín ve formátu YYYY-MM-DD"),
        assignee_ids: z
          .array(z.string())
          .optional()
          .describe("user_id řešitelů; musí být členové projektu"),
      },
    },
    async ({ project_id, title, description, due_date, assignee_ids }, extra) => {
      const { client } = clientFor(extra);
      const { data: proj, error: pe } = await client
        .from("projects")
        .select("workspace_id")
        .eq("id", project_id)
        .single();
      if (pe || !proj) return fail("Projekt nenalezen nebo k němu nemáš přístup.");

      const { data: task, error: te } = await client
        .from("tasks")
        .insert({
          workspace_id: proj.workspace_id,
          project_id,
          title,
          description: description ?? "",
          due_date: due_date ?? null,
        })
        .select("id, title")
        .single();
      if (te || !task)
        return fail("Úkol se nepodařilo založit: " + (te?.message ?? "neznámá chyba"));

      const assigned: string[] = [];
      const failedAssign: string[] = [];
      for (const uid of assignee_ids ?? []) {
        const { error: ae } = await client
          .from("task_assignees")
          .insert({ task_id: task.id, user_id: uid });
        if (ae) failedAssign.push(uid);
        else assigned.push(uid);
      }

      return ok({
        created: task,
        assigned,
        failedAssign,
        note: failedAssign.length
          ? "Někteří řešitelé nejsou členy projektu — nešli přiřadit."
          : undefined,
      });
    }
  );

  server.registerTool(
    "assign_task",
    {
      title: "Přiřadit řešitele",
      description:
        "Přidá uživatele jako řešitele úkolu. Řešitel musí být člen projektu; přiřazení mu pošle notifikaci.",
      inputSchema: { task_id: z.string(), user_id: z.string() },
    },
    async ({ task_id, user_id }, extra) => {
      const { client } = clientFor(extra);
      const { error } = await client
        .from("task_assignees")
        .insert({ task_id, user_id });
      if (error)
        return fail(
          "Nepodařilo se přiřadit — řešitel musí být členem projektu úkolu. (" +
            error.message +
            ")"
        );
      return ok({ task_id, assigned: user_id, notified: true });
    }
  );

  server.registerTool(
    "list_my_tasks",
    {
      title: "Moje úkoly",
      description: "Nedokončené úkoly přiřazené přihlášenému uživateli.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const { client, userId } = clientFor(extra);
      const { data, error } = await client
        .from("tasks")
        .select(
          "id, title, due_date, completed_at, projects(name), task_assignees!inner(user_id)"
        )
        .eq("task_assignees.user_id", userId)
        .is("completed_at", null)
        .order("due_date", { nullsFirst: false });
      return error ? fail(error.message) : ok(data);
    }
  );

  server.registerTool(
    "add_comment",
    {
      title: "Přidat komentář",
      description:
        "Přidá komentář k úkolu pod jménem uživatele. Notifikuje řešitele a autora karty.",
      inputSchema: { task_id: z.string(), body: z.string() },
    },
    async ({ task_id, body }, extra) => {
      const { client } = clientFor(extra);
      const { data: t, error: te } = await client
        .from("tasks")
        .select("workspace_id")
        .eq("id", task_id)
        .single();
      if (te || !t) return fail("Úkol nenalezen nebo k němu nemáš přístup.");

      const { data, error } = await client
        .from("task_comments")
        .insert({ task_id, workspace_id: t.workspace_id, body })
        .select("id")
        .single();
      if (error) return fail("Komentář se nepodařilo přidat: " + error.message);
      return ok({ comment_id: data.id, task_id });
    }
  );
}
