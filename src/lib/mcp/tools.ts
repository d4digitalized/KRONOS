import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createUserClient } from "./auth";
import { syncTaskCalendarCore } from "@/lib/calendarSync";

/** Datum+čas v Europe/Prague → UTC Date (server běží v UTC; respektuje
    letní/zimní čas daného dne). */
function pragueDate(date: string, time: string): Date {
  const probe = new Date(`${date}T12:00:00Z`);
  const offsetName =
    new Intl.DateTimeFormat("en", {
      timeZone: "Europe/Prague",
      timeZoneName: "longOffset",
    })
      .formatToParts(probe)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT+01:00";
  const m = offsetName.match(/GMT([+-])(\d{2}):(\d{2})/);
  const sign = m?.[1] === "-" ? -1 : 1;
  const offMin = sign * (Number(m?.[2] ?? 1) * 60 + Number(m?.[3] ?? 0));
  return new Date(new Date(`${date}T${time}:00Z`).getTime() - offMin * 60_000);
}

// Nástroje MCP serveru Kronos. Každý běží pod JWT přihlášeného uživatele
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
    "whoami",
    {
      title: "Kdo jsem",
      description:
        "Identita přihlášeného uživatele: user_id, jméno, e-mail, super-admin. user_id použij, když má uživatel přiřadit úkol sám sobě.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const { client, userId } = clientFor(extra);
      const { data, error } = await client
        .from("profiles")
        .select("id, full_name, email, tag_name, is_super_admin")
        .eq("id", userId)
        .single();
      return error ? fail(error.message) : ok(data);
    }
  );

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
        "Členové projektu. Přiřadit jako řešitele (assign_task) lze je NEBO adminy workspace — adminy získáš z list_workspace_members.",
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
    "list_workspace_members",
    {
      title: "Členové workspace",
      description:
        "Všichni členové workspace + role (admin/member). Přiřadit na úkol lze členy projektu i adminy workspace.",
      inputSchema: { workspace_id: z.string() },
    },
    async ({ workspace_id }, extra) => {
      const { client } = clientFor(extra);
      const { data, error } = await client
        .from("workspace_members")
        .select("user_id, role, profiles(id, full_name, email, tag_name)")
        .eq("workspace_id", workspace_id);
      return error ? fail(error.message) : ok(data);
    }
  );

  server.registerTool(
    "create_task",
    {
      title: "Založit úkol",
      description:
        "Vytvoří úkol v projektu pod jménem uživatele. Volitelně rovnou přiřadí řešitele (členy projektu nebo adminy workspace). Sám sobě: vezmi user_id z whoami.",
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
    "get_task",
    {
      title: "Detail úkolu",
      description:
        "Detail úkolu včetně popisu — použij např. před update_task_description, když se má popis doplnit a ne přepsat.",
      inputSchema: { task_id: z.string() },
    },
    async ({ task_id }, extra) => {
      const { client } = clientFor(extra);
      const { data, error } = await client
        .from("tasks")
        .select(
          "id, title, description, due_date, priority, completed_at, planned_start, planned_end, projects(name), task_assignees(user_id, profiles(full_name))"
        )
        .eq("id", task_id)
        .single();
      if (error || !data)
        return fail("Úkol nenalezen nebo k němu nemáš přístup.");
      return ok(data);
    }
  );

  server.registerTool(
    "plan_task",
    {
      title: "Naplánovat úkol v čase",
      description:
        "Nastaví úkolu plánované okno (kdy se na něm bude dělat) — datum + od–do v čase Europe/Prague. Okno se zobrazí v Můj den a propíše se řešitelům do Google kalendáře „{jméno} - KRONOS\". Není to termín úkolu (due_date). Pro zrušení plánu použij unplan_task.",
      inputSchema: {
        task_id: z.string(),
        date: z.string().describe("den plánu, YYYY-MM-DD"),
        from: z.string().describe("začátek HH:MM (Europe/Prague)"),
        to: z.string().describe("konec HH:MM (Europe/Prague)"),
      },
    },
    async ({ task_id, date, from, to }, extra) => {
      const { client, userId } = clientFor(extra);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) {
        return fail("Formát: date YYYY-MM-DD, from/to HH:MM.");
      }
      if (to <= from) return fail("Konec plánu musí být po začátku.");
      const start = pragueDate(date, from);
      const end = pragueDate(date, to);
      const { data, error } = await client
        .from("tasks")
        .update({
          planned_start: start.toISOString(),
          planned_end: end.toISOString(),
        })
        .eq("id", task_id)
        .select("id, title")
        .single();
      if (error || !data)
        return fail("Úkol nenalezen nebo k němu nemáš přístup.");
      const sync = await syncTaskCalendarCore(client, userId, task_id);
      return ok({
        planned: data.title,
        date,
        from,
        to,
        calendar: sync.error ?? `událost zapsána (${sync.synced ?? 0}×)`,
      });
    }
  );

  server.registerTool(
    "unplan_task",
    {
      title: "Zrušit plán úkolu",
      description:
        "Smaže plánované okno úkolu (planned_start/planned_end) a odpovídající události v kalendářích řešitelů. Úkol i jeho termín zůstávají.",
      inputSchema: { task_id: z.string() },
    },
    async ({ task_id }, extra) => {
      const { client, userId } = clientFor(extra);
      const { data, error } = await client
        .from("tasks")
        .update({ planned_start: null, planned_end: null })
        .eq("id", task_id)
        .select("id, title")
        .single();
      if (error || !data)
        return fail("Úkol nenalezen nebo k němu nemáš přístup.");
      const sync = await syncTaskCalendarCore(client, userId, task_id);
      return ok({
        unplanned: data.title,
        calendar: sync.error ?? "události smazány",
      });
    }
  );

  server.registerTool(
    "update_task_description",
    {
      title: "Upravit popis úkolu",
      description:
        "Nastaví popis existujícího úkolu (přepíše ten stávající). Pro doplnění si nejdřív načti úkol a pošli celý nový text.",
      inputSchema: {
        task_id: z.string(),
        description: z.string().describe("nový popis úkolu; prázdný řetězec popis smaže"),
      },
    },
    async ({ task_id, description }, extra) => {
      const { client } = clientFor(extra);
      const { data, error } = await client
        .from("tasks")
        .update({ description })
        .eq("id", task_id)
        .select("id, title")
        .single();
      if (error || !data)
        return fail("Úkol nenalezen nebo k němu nemáš přístup.");
      return ok({ updated: data.id, title: data.title });
    }
  );

  server.registerTool(
    "assign_task",
    {
      title: "Přiřadit řešitele",
      description:
        "Přidá uživatele jako řešitele úkolu (člen projektu nebo admin workspace). Sám sobě: user_id z whoami. Přiřazení pošle notifikaci.",
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
