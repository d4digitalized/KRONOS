export const TASKS_CHANGED_EVENT = "toggled:tasks-changed";

/** Oznámí otevřeným přehledům, že se změnily úkoly (např. přibyl nový). */
export function notifyTasksChanged() {
  window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));
}
