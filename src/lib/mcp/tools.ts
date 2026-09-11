import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createUserClient } from "./auth";
import { syncTaskCalendarCore } from "@/lib/calendarSync";
import { posBetween } from "@/lib/position";
import { entrySeconds } from "@/lib/format";

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

/** YYYY-MM-DD následujícího dne. */
function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** ISO čas → „YYYY-MM-DD HH:MM" v Europe/Prague (pro výstupy). */
function pragueStamp(iso: string | null): string | null {
  if (!iso) return null;
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
  return parts.replace("T", " ");
}

const minutes = (started: string, stopped: string | null) =>
  Math.round(entrySeconds(started, stopped) / 60);

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
    "create_project",
    {
      title: "Založit projekt",
      description:
        "Založí aktivní projekt (nástěnku) ve workspace. Smí jen admin workspace — stejně jako ve Správě projektů. Projekt dostane automaticky sloupec Backlog; vrácené id lze rovnou použít v create_task.",
      inputSchema: {
        workspace_id: z.string(),
        name: z.string().describe("název projektu"),
      },
    },
    async ({ workspace_id, name }, extra) => {
      const { client } = clientFor(extra);
      const trimmed = name.trim();
      if (!trimmed) return fail("Název projektu nesmí být prázdný.");
      // na konec seznamu (Správa projektů řadí podle position)
      const { data: last } = await client
        .from("projects")
        .select("position")
        .eq("workspace_id", workspace_id)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
      const position = Math.max(0, Number(last?.position ?? 0)) + 1;
      const { data, error } = await client
        .from("projects")
        .insert({ workspace_id, name: trimmed, position })
        .select("id, name, workspace_id")
        .single();
      if (error || !data)
        return fail(
          "Projekt se nepodařilo založit — projekt smí zakládat jen admin workspace. (" +
            (error?.message ?? "neznámá chyba") +
            ")"
        );
      return ok(data);
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
    "list_tasks",
    {
      title: "Úkoly projektu",
      description:
        "Úkoly na nástěnce projektu: sloupec, stav (open / hold / waiting / done), termín, priorita, řešitelé. Vrací i sloupce nástěnky (název + column_id) pro move_task. Standardně jen nedokončené; include_done přidá i hotové.",
      inputSchema: {
        project_id: z.string(),
        include_done: z
          .boolean()
          .optional()
          .describe("vrátit i dokončené úkoly (default false)"),
      },
    },
    async ({ project_id, include_done }, extra) => {
      const { client } = clientFor(extra);
      let q = client
        .from("tasks")
        .select(
          "id, title, due_date, priority, completed_at, on_hold, column_id, position, board_columns(name), task_followups(task_id), task_assignees(user_id, profiles(full_name))"
        )
        .eq("project_id", project_id)
        .is("parent_id", null)
        .order("position");
      if (!include_done) q = q.is("completed_at", null);
      const [colsRes, tasksRes] = await Promise.all([
        client
          .from("board_columns")
          .select("id, name")
          .eq("project_id", project_id)
          .order("position"),
        q,
      ]);
      if (colsRes.error) return fail(colsRes.error.message);
      if (tasksRes.error) return fail(tasksRes.error.message);
      type Row = {
        id: string;
        title: string;
        due_date: string | null;
        priority: number | null;
        completed_at: string | null;
        on_hold: boolean | null;
        column_id: string | null;
        board_columns: { name: string } | { name: string }[] | null;
        task_followups: unknown;
        task_assignees: { user_id: string; profiles: { full_name: string } | null }[];
      };
      const rows = (tasksRes.data ?? []) as unknown as Row[];
      const tasks = rows.map((t) => {
        const col = Array.isArray(t.board_columns) ? t.board_columns[0] : t.board_columns;
        const waiting = Array.isArray(t.task_followups)
          ? t.task_followups.length > 0
          : !!t.task_followups;
        return {
          id: t.id,
          title: t.title,
          status: t.completed_at
            ? "done"
            : t.on_hold
              ? "hold"
              : waiting
                ? "waiting"
                : "open",
          column: col?.name ?? null,
          column_id: t.column_id,
          due_date: t.due_date,
          priority: t.priority,
          completed_at: t.completed_at,
          assignees: (t.task_assignees ?? []).map((a) => ({
            user_id: a.user_id,
            name: a.profiles?.full_name ?? "",
          })),
        };
      });
      return ok({ columns: colsRes.data, tasks });
    }
  );

  server.registerTool(
    "complete_task",
    {
      title: "Dokončit úkol",
      description:
        "Označí úkol jako hotový (completed=true, výchozí) nebo ho znovu otevře (completed=false). U opakovaného úkolu se po dokončení automaticky založí další výskyt.",
      inputSchema: {
        task_id: z.string(),
        completed: z
          .boolean()
          .optional()
          .describe("true = dokončit (výchozí), false = znovu otevřít"),
      },
    },
    async ({ task_id, completed }, extra) => {
      const { client } = clientFor(extra);
      const done = completed ?? true;
      const { data, error } = await client
        .from("tasks")
        .update(
          done
            ? { completed_at: new Date().toISOString(), on_hold: false }
            : { completed_at: null }
        )
        .eq("id", task_id)
        .select("id, title, completed_at")
        .single();
      if (error || !data)
        return fail("Úkol nenalezen nebo k němu nemáš přístup.");
      return ok({ task_id: data.id, title: data.title, completed: !!data.completed_at });
    }
  );

  server.registerTool(
    "move_task",
    {
      title: "Přesunout úkol do sloupce",
      description:
        "Přesune úkol na konec sloupce nástěnky jeho projektu — podle názvu sloupce (bez ohledu na velikost písmen) nebo column_id z list_tasks. Uspaný, čekající i hotový úkol tím znovu otevře. Hodnota \"hold\" úkol uspí (sloupec Hold). Pro dokončení použij complete_task.",
      inputSchema: {
        task_id: z.string(),
        column: z
          .string()
          .describe("název sloupce, column_id, nebo \"hold\""),
      },
    },
    async ({ task_id, column }, extra) => {
      const { client } = clientFor(extra);
      const { data: task, error: te } = await client
        .from("tasks")
        .select("id, title, project_id")
        .eq("id", task_id)
        .single();
      if (te || !task) return fail("Úkol nenalezen nebo k němu nemáš přístup.");

      const wanted = column.trim().toLowerCase();
      if (wanted === "hold") {
        const { error } = await client
          .from("tasks")
          .update({ on_hold: true })
          .eq("id", task_id);
        return error
          ? fail("Uspání se nezdařilo: " + error.message)
          : ok({ task_id, title: task.title, moved_to: "hold" });
      }

      const { data: cols, error: ce } = await client
        .from("board_columns")
        .select("id, name")
        .eq("project_id", task.project_id)
        .order("position");
      if (ce) return fail(ce.message);
      const target = (cols ?? []).find(
        (c) => c.id === column || (c.name as string).trim().toLowerCase() === wanted
      );
      if (!target)
        return fail(
          `Sloupec „${column}“ na nástěnce není. K dispozici: ${(cols ?? [])
            .map((c) => c.name)
            .join(", ")}`
        );

      // na konec sloupce; čekání (follow-up) zrušit, uspání i dokončení vrátit
      const { data: last } = await client
        .from("tasks")
        .select("position")
        .eq("column_id", target.id)
        .is("completed_at", null)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
      const position = posBetween(last?.position ?? undefined, undefined);
      await client.from("task_followups").delete().eq("task_id", task_id);
      const { error } = await client
        .from("tasks")
        .update({ column_id: target.id, position, on_hold: false, completed_at: null })
        .eq("id", task_id);
      if (error) return fail("Přesun se nezdařil: " + error.message);
      return ok({ task_id, title: task.title, moved_to: target.name });
    }
  );

  server.registerTool(
    "list_comments",
    {
      title: "Komentáře úkolu",
      description:
        "Komentáře k úkolu od nejstaršího po nejnovější: autor, čas (Europe/Prague), text.",
      inputSchema: { task_id: z.string() },
    },
    async ({ task_id }, extra) => {
      const { client } = clientFor(extra);
      const { data, error } = await client
        .from("task_comments")
        .select("id, body, created_at, author_id, profiles(full_name, email)")
        .eq("task_id", task_id)
        .order("created_at");
      if (error) return fail(error.message);
      type Row = {
        id: string;
        body: string;
        created_at: string;
        author_id: string;
        profiles: { full_name: string; email: string } | null;
      };
      const rows = (data ?? []) as unknown as Row[];
      return ok(
        rows.map((c) => ({
          id: c.id,
          author_id: c.author_id,
          author: c.profiles?.full_name || c.profiles?.email || "",
          at: pragueStamp(c.created_at),
          body: c.body,
        }))
      );
    }
  );

  server.registerTool(
    "set_due_date",
    {
      title: "Nastavit termín úkolu",
      description:
        "Nastaví termín úkolu (due_date). Prázdný řetězec termín smaže. Plánované okno (kdy se na tom dělá) řeší plan_task.",
      inputSchema: {
        task_id: z.string(),
        due_date: z
          .string()
          .describe("YYYY-MM-DD, nebo prázdný řetězec pro smazání termínu"),
      },
    },
    async ({ task_id, due_date }, extra) => {
      const { client } = clientFor(extra);
      const value = due_date.trim();
      if (value && !DATE_RE.test(value)) return fail("Formát termínu: YYYY-MM-DD.");
      const { data, error } = await client
        .from("tasks")
        .update({ due_date: value || null })
        .eq("id", task_id)
        .select("id, title, due_date")
        .single();
      if (error || !data)
        return fail("Úkol nenalezen nebo k němu nemáš přístup.");
      return ok({ task_id: data.id, title: data.title, due_date: data.due_date });
    }
  );

  // ---------------------------------------------------------------- čas

  server.registerTool(
    "current_timer",
    {
      title: "Běžící timer",
      description:
        "Vrátí právě běžící timer přihlášeného uživatele (úkol, projekt, popis, od kdy, uplynulé minuty), nebo running=false.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const { client, userId } = clientFor(extra);
      const { data, error } = await client
        .from("time_entries")
        .select("id, started_at, description, workspace_id, project_id, task_id, projects(name), tasks(title)")
        .eq("user_id", userId)
        .is("stopped_at", null)
        .maybeSingle();
      if (error) return fail(error.message);
      if (!data) return ok({ running: false });
      type Row = {
        id: string;
        started_at: string;
        description: string;
        workspace_id: string;
        project_id: string | null;
        task_id: string | null;
        projects: { name: string } | null;
        tasks: { title: string } | null;
      };
      const e = data as unknown as Row;
      return ok({
        running: true,
        entry_id: e.id,
        workspace_id: e.workspace_id,
        project_id: e.project_id,
        project: e.projects?.name ?? null,
        task_id: e.task_id,
        task: e.tasks?.title ?? null,
        description: e.description,
        started_at: pragueStamp(e.started_at),
        minutes: minutes(e.started_at, null),
      });
    }
  );

  server.registerTool(
    "start_timer",
    {
      title: "Spustit timer",
      description:
        "Spustí měření času přihlášenému uživateli. Zadej task_id (projekt i workspace se dohledají), nebo project_id, nebo jen workspace_id pro volný timer. Případný běžící timer se nejdřív zastaví a uloží.",
      inputSchema: {
        task_id: z.string().optional(),
        project_id: z.string().optional(),
        workspace_id: z.string().optional(),
        description: z.string().optional().describe("popis činnosti"),
      },
    },
    async ({ task_id, project_id, workspace_id, description }, extra) => {
      const { client, userId } = clientFor(extra);
      let wsId = workspace_id ?? null;
      let projId = project_id ?? null;
      let taskTitle: string | null = null;
      if (task_id) {
        const { data: t } = await client
          .from("tasks")
          .select("title, workspace_id, project_id")
          .eq("id", task_id)
          .maybeSingle();
        if (!t) return fail("Úkol nenalezen nebo k němu nemáš přístup.");
        wsId = t.workspace_id;
        projId = projId ?? t.project_id;
        taskTitle = t.title;
      } else if (projId) {
        const { data: p } = await client
          .from("projects")
          .select("workspace_id")
          .eq("id", projId)
          .maybeSingle();
        if (!p) return fail("Projekt nenalezen nebo k němu nemáš přístup.");
        wsId = p.workspace_id;
      }
      if (!wsId) return fail("Zadej task_id, project_id nebo workspace_id.");

      // zastavit běžící timer
      const stoppedAt = new Date().toISOString();
      const { data: running } = await client
        .from("time_entries")
        .select("id, started_at")
        .eq("user_id", userId)
        .is("stopped_at", null)
        .maybeSingle();
      if (running) {
        await client
          .from("time_entries")
          .update({ stopped_at: stoppedAt })
          .eq("id", running.id);
      }

      const { data, error } = await client
        .from("time_entries")
        .insert({
          workspace_id: wsId,
          project_id: projId,
          task_id: task_id ?? null,
          description: description ?? "",
          user_id: userId,
        })
        .select("id, started_at")
        .single();
      if (error || !data) return fail("Timer se nepodařilo spustit: " + (error?.message ?? ""));
      return ok({
        started: true,
        entry_id: data.id,
        task: taskTitle,
        started_at: pragueStamp(data.started_at),
        previous_stopped: running
          ? { entry_id: running.id, minutes: minutes(running.started_at, stoppedAt) }
          : null,
      });
    }
  );

  server.registerTool(
    "stop_timer",
    {
      title: "Zastavit timer",
      description:
        "Zastaví běžící timer přihlášeného uživatele a uloží záznam. Volitelně doplní popis.",
      inputSchema: {
        description: z.string().optional().describe("popis činnosti (přepíše stávající)"),
      },
    },
    async ({ description }, extra) => {
      const { client, userId } = clientFor(extra);
      const { data: running } = await client
        .from("time_entries")
        .select("id, started_at")
        .eq("user_id", userId)
        .is("stopped_at", null)
        .maybeSingle();
      if (!running) return ok({ stopped: false, note: "Žádný timer neběží." });
      const stoppedAt = new Date().toISOString();
      const { error } = await client
        .from("time_entries")
        .update({
          stopped_at: stoppedAt,
          ...(description !== undefined ? { description } : {}),
        })
        .eq("id", running.id);
      if (error) return fail("Timer se nepodařilo zastavit: " + error.message);
      return ok({
        stopped: true,
        entry_id: running.id,
        minutes: minutes(running.started_at, stoppedAt),
      });
    }
  );

  server.registerTool(
    "add_time_entry",
    {
      title: "Zapsat čas ručně",
      description:
        "Uloží hotový záznam času přihlášeného uživatele: den + od–do (Europe/Prague). Zadej task_id, nebo project_id, nebo workspace_id.",
      inputSchema: {
        date: z.string().describe("den, YYYY-MM-DD"),
        from: z.string().describe("začátek HH:MM"),
        to: z.string().describe("konec HH:MM"),
        task_id: z.string().optional(),
        project_id: z.string().optional(),
        workspace_id: z.string().optional(),
        description: z.string().optional(),
      },
    },
    async ({ date, from, to, task_id, project_id, workspace_id, description }, extra) => {
      const { client, userId } = clientFor(extra);
      if (!DATE_RE.test(date) || !TIME_RE.test(from) || !TIME_RE.test(to))
        return fail("Formát: date YYYY-MM-DD, from/to HH:MM.");
      if (to <= from) return fail("Konec musí být po začátku.");
      let wsId = workspace_id ?? null;
      let projId = project_id ?? null;
      if (task_id) {
        const { data: t } = await client
          .from("tasks")
          .select("workspace_id, project_id")
          .eq("id", task_id)
          .maybeSingle();
        if (!t) return fail("Úkol nenalezen nebo k němu nemáš přístup.");
        wsId = t.workspace_id;
        projId = projId ?? t.project_id;
      } else if (projId) {
        const { data: p } = await client
          .from("projects")
          .select("workspace_id")
          .eq("id", projId)
          .maybeSingle();
        if (!p) return fail("Projekt nenalezen nebo k němu nemáš přístup.");
        wsId = p.workspace_id;
      }
      if (!wsId) return fail("Zadej task_id, project_id nebo workspace_id.");
      const started = pragueDate(date, from);
      const stopped = pragueDate(date, to);
      const { data, error } = await client
        .from("time_entries")
        .insert({
          workspace_id: wsId,
          project_id: projId,
          task_id: task_id ?? null,
          description: description ?? "",
          user_id: userId,
          started_at: started.toISOString(),
          stopped_at: stopped.toISOString(),
        })
        .select("id")
        .single();
      if (error || !data) return fail("Záznam se nepodařilo uložit: " + (error?.message ?? ""));
      return ok({ entry_id: data.id, minutes: minutes(started.toISOString(), stopped.toISOString()) });
    }
  );

  server.registerTool(
    "list_time_entries",
    {
      title: "Výkazy času",
      description:
        "Záznamy času za období (dny včetně, Europe/Prague) + součty po lidech a projektech. Vidíš své záznamy; admin workspace vidí všechny, HR ty, na které má grant. Volitelně omez na workspace, uživatele nebo projekt. summary_only vrátí jen součty (pro dlouhá období).",
      inputSchema: {
        from: z.string().describe("od, YYYY-MM-DD (včetně)"),
        to: z.string().describe("do, YYYY-MM-DD (včetně)"),
        workspace_id: z.string().optional(),
        user_id: z.string().optional().describe("jen jeden člověk (user_id z list_workspace_members)"),
        project_id: z.string().optional(),
        summary_only: z.boolean().optional().describe("jen součty, bez jednotlivých záznamů"),
      },
    },
    async ({ from, to, workspace_id, user_id, project_id, summary_only }, extra) => {
      const { client } = clientFor(extra);
      if (!DATE_RE.test(from) || !DATE_RE.test(to)) return fail("Formát: from/to YYYY-MM-DD.");
      if (to < from) return fail("„to“ musí být stejné nebo pozdější než „from“.");
      let q = client
        .from("time_entries")
        .select(
          "id, user_id, workspace_id, project_id, task_id, description, started_at, stopped_at, profiles(full_name, email), projects(name), tasks(title)"
        )
        .gte("started_at", pragueDate(from, "00:00").toISOString())
        .lt("started_at", pragueDate(nextDay(to), "00:00").toISOString())
        .order("started_at")
        .limit(1000);
      if (workspace_id) q = q.eq("workspace_id", workspace_id);
      if (user_id) q = q.eq("user_id", user_id);
      if (project_id) q = q.eq("project_id", project_id);
      const { data, error } = await q;
      if (error) return fail(error.message);
      type Row = {
        id: string;
        user_id: string;
        workspace_id: string;
        project_id: string | null;
        task_id: string | null;
        description: string;
        started_at: string;
        stopped_at: string | null;
        profiles: { full_name: string; email: string } | null;
        projects: { name: string } | null;
        tasks: { title: string } | null;
      };
      const rows = (data ?? []) as unknown as Row[];
      const byUser = new Map<string, { user_id: string; name: string; minutes: number }>();
      const byProject = new Map<string, { project_id: string | null; name: string; minutes: number }>();
      const byUserProject = new Map<string, { user: string; project: string; minutes: number }>();
      let total = 0;
      for (const e of rows) {
        const min = minutes(e.started_at, e.stopped_at);
        total += min;
        const name = e.profiles?.full_name || e.profiles?.email || e.user_id;
        const proj = e.projects?.name ?? "(bez projektu)";
        const u = byUser.get(e.user_id) ?? { user_id: e.user_id, name, minutes: 0 };
        u.minutes += min;
        byUser.set(e.user_id, u);
        const pk = e.project_id ?? "";
        const p = byProject.get(pk) ?? { project_id: e.project_id, name: proj, minutes: 0 };
        p.minutes += min;
        byProject.set(pk, p);
        const upk = `${e.user_id}|${pk}`;
        const up = byUserProject.get(upk) ?? { user: name, project: proj, minutes: 0 };
        up.minutes += min;
        byUserProject.set(upk, up);
      }
      const desc = (a: { minutes: number }, b: { minutes: number }) => b.minutes - a.minutes;
      return ok({
        from,
        to,
        total_minutes: total,
        entries_count: rows.length,
        truncated: rows.length >= 1000 ? "vráceno prvních 1000 záznamů, zúž období" : undefined,
        by_user: [...byUser.values()].sort(desc),
        by_project: [...byProject.values()].sort(desc),
        by_user_and_project: [...byUserProject.values()].sort(desc),
        entries: summary_only
          ? undefined
          : rows.map((e) => ({
              id: e.id,
              user: e.profiles?.full_name || e.profiles?.email || e.user_id,
              user_id: e.user_id,
              project: e.projects?.name ?? null,
              project_id: e.project_id,
              task: e.tasks?.title ?? null,
              task_id: e.task_id,
              description: e.description,
              started_at: pragueStamp(e.started_at),
              stopped_at: pragueStamp(e.stopped_at),
              running: !e.stopped_at,
              minutes: minutes(e.started_at, e.stopped_at),
            })),
      });
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
