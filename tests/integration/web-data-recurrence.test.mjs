// Recurrence rules through the data layer of the web app against the disposable instance (E5 plan,
// packages 4 to 6). The TypeScript modules from web/src/lib/data are imported directly.

import { beforeAll, describe, expect, it } from "vitest";
import { superuserClient } from "../support/api.mjs";
import { createOwner, historyOf, uniqueCode } from "../support/scenario.mjs";
import { addDays, berlinToday } from "../../web/src/lib/domain/berlin-date.ts";
import {
  defaultFormValues,
  formParams,
  formPreview,
  formValuesOf,
} from "../../web/src/lib/domain/recurrence-rule.ts";
import {
  itemSuggestion,
  suggestionFormValues,
} from "../../web/src/lib/domain/rrule.ts";
import {
  templateBody,
  ticketTemplate,
} from "../../web/src/lib/domain/series-template.ts";
import { DataError } from "../../web/src/lib/data/errors.ts";
import { createItem, getItem } from "../../web/src/lib/data/inbox.ts";
import {
  createRule,
  deleteRule,
  detachTicket,
  eachOccurrenceReady,
  initialStatusReady,
  listRules,
  setRuleActive,
  updateRule,
} from "../../web/src/lib/data/recurrence.ts";
import {
  createTicket,
  getTicket,
  updateTicket,
} from "../../web/src/lib/data/tickets.ts";

async function dataErrorOf(promise) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DataError);
    return error;
  }
  throw new Error("Expected the call to fail, but it succeeded.");
}

const draft = (overrides = {}) => ({
  title: "Müll rausbringen",
  description: "Gelbe Tonne",
  project: null,
  tags: [],
  priority: "high",
  mode: "calendar",
  freq: "weekly",
  interval: 1,
  weekdays: ["MO"],
  month_day: 0,
  anchor: "2031-01-06",
  lead_days: 3,
  ...overrides,
});

describe("web data layer: recurrence rules", () => {
  let superuser;

  beforeAll(async () => {
    superuser = await superuserClient();
  });

  it("creates, lists, changes, pauses and deletes a rule only its owner sees", async () => {
    const owner = await createOwner(superuser);
    const other = await createOwner(superuser);

    const rule = await createRule(owner.client, draft());
    expect(rule).toMatchObject({
      title: "Müll rausbringen",
      description: "Gelbe Tonne",
      projectId: null,
      priority: "high",
      mode: "calendar",
      freq: "weekly",
      interval: 1,
      weekdays: ["MO"],
      monthDay: null,
      anchor: "2031-01-06",
      leadDays: 3,
      nextDue: "2031-01-06",
      active: true,
      lastHint: "",
    });
    expect(await listRules(owner.client)).toEqual([rule]);
    expect(await listRules(other.client)).toEqual([]);

    const monthly = await updateRule(owner.client, rule.id, {
      freq: "monthly",
      weekdays: [],
      month_day: -1,
    });
    expect(monthly).toMatchObject({
      freq: "monthly",
      weekdays: [],
      monthDay: -1,
      nextDue: "2031-01-31",
    });

    expect((await setRuleActive(owner.client, rule.id, false)).active).toBe(
      false,
    );
    expect(
      (await dataErrorOf(setRuleActive(other.client, rule.id, true))).kind,
    ).toBe("not_found");

    await deleteRule(owner.client, rule.id);
    expect(await listRules(owner.client)).toEqual([]);
  });

  it("makes a ticket the instance of a new rule and releases it again", async () => {
    const owner = await createOwner(superuser);
    const ticket = await owner.ticket({ due: "2031-01-06" });

    const rule = await createRule(
      owner.client,
      draft({ title: ticket.title }),
      ticket.id,
    );
    expect(rule.nextDue).toBe("2031-01-13");
    const linked = await getTicket(owner.client, ticket.id);
    expect(linked).toMatchObject({ recurring: true, recurrenceId: rule.id });

    const released = await detachTicket(owner.client, ticket.id);
    expect(released).toMatchObject({
      id: ticket.id,
      recurring: false,
      recurrenceId: null,
    });
  });

  // ADR-0023 addendum 4: the way out of a refused reopening sends status and recurrence "".
  it("reopens a done instance as a normal ticket in one request", async () => {
    const owner = await createOwner(superuser);
    const ticket = await owner.ticket({ due: "2031-01-06" });
    const rule = await createRule(owner.client, draft({ title: ticket.title }), ticket.id);
    await updateTicket(owner.client, ticket.id, { status: "done" });

    const reopened = await updateTicket(owner.client, ticket.id, {
      status: "open",
      detachSeries: true,
    });
    expect(reopened).toMatchObject({ status: "open", recurring: false, recurrenceId: null });
    expect((await listRules(owner.client)).find((item) => item.id === rule.id)?.nextDue).toBe(
      rule.nextDue,
    );
  });

  it("reports field errors with the codes and texts of the hook", async () => {
    const owner = await createOwner(superuser);
    const error = await dataErrorOf(
      createRule(owner.client, draft({ weekdays: [], anchor: "kein Datum" })),
    );
    expect(error.kind).toBe("validation");
    expect(error.fields.anchor).toMatchObject({
      code: "validation_recurrence_anchor",
      message: "Bitte ein gültiges Datum für „Beginnt am“ wählen.",
    });

    const done = await owner.ticket({ status: "done" });
    const refused = await dataErrorOf(
      createRule(owner.client, draft(), done.id),
    );
    expect(refused.fields.ticket).toMatchObject({
      code: "validation_recurrence_ticket_done",
      message: "Ein erledigtes Ticket kann keine Serie beginnen.",
    });
  });
});

describe('web data layer: overview "Wiederholungen" (E5 plan, package 5)', () => {
  let superuser;

  beforeAll(async () => {
    superuser = await superuserClient();
  });

  const instancesOf = (owner, ruleId) =>
    owner.client
      .collection("tickets")
      .getFullList({
        filter: owner.client.filter("recurrence = {:id}", { id: ruleId }),
      });

  it("creates the first ticket of a new rule at once when it is within the lead time", async () => {
    const owner = await createOwner(superuser);
    const today = berlinToday(Date.now());
    const rule = await createRule(
      owner.client,
      draft({ freq: "daily", weekdays: [], anchor: today, lead_days: 0 }),
    );
    const instances = await instancesOf(owner, rule.id);
    expect(instances).toHaveLength(1);
    // The server may already count the next day if the test runs across Berlin midnight.
    expect([today, addDays(today, 1)]).toContain(instances[0].due.slice(0, 10));
    expect(instances[0]).toMatchObject({
      title: "Müll rausbringen",
      status: "open",
    });

    // A rule far ahead creates nothing yet; its next ticket is its first date.
    const later = await createRule(owner.client, draft({ title: "Später" }));
    expect(later.nextDue).toBe("2031-01-06");
    expect(await instancesOf(owner, later.id)).toEqual([]);
  });

  it("keeps the open ticket when the template changes and recomputes the next ticket for a new rhythm", async () => {
    const owner = await createOwner(superuser);
    const today = berlinToday(Date.now());
    const rule = await createRule(
      owner.client,
      draft({ freq: "daily", weekdays: [], anchor: today, lead_days: 0 }),
    );
    const [instance] = await instancesOf(owner, rule.id);
    // The answer of the create came before the first ticket; the rule has moved on since.
    const [current] = await listRules(owner.client);
    expect(current.nextDue > rule.nextDue).toBe(true);

    const renamed = await updateRule(owner.client, rule.id, {
      title: "Neue Vorlage",
      priority: "low",
    });
    expect(renamed).toMatchObject({
      title: "Neue Vorlage",
      priority: "low",
      nextDue: current.nextDue,
    });
    expect(await getTicket(owner.client, instance.id)).toMatchObject({
      title: "Müll rausbringen",
      priority: "high",
    });

    const far = await createRule(owner.client, draft());
    const thursday = await updateRule(owner.client, far.id, {
      weekdays: ["TH"],
    });
    expect(thursday.nextDue).toBe("2031-01-09");
    // The preview of the panel shows the same first date as the saved next ticket.
    expect(formPreview(formValuesOf(thursday, today), today).dates[0]).toBe(
      thursday.nextDue,
    );
  });

  it("deletes a rule and leaves its open ticket without the series", async () => {
    const owner = await createOwner(superuser);
    const today = berlinToday(Date.now());
    const rule = await createRule(
      owner.client,
      draft({ freq: "daily", weekdays: [], anchor: today, lead_days: 0 }),
    );
    const [instance] = await instancesOf(owner, rule.id);

    await deleteRule(owner.client, rule.id);
    expect(await listRules(owner.client)).toEqual([]);
    expect(await getTicket(owner.client, instance.id)).toMatchObject({
      id: instance.id,
      recurring: false,
      recurrenceId: null,
    });
    const removal = (await historyOf(superuser, instance.id)).find(
      (entry) => entry.field === "recurrence" && entry.old_value === rule.id,
    );
    expect(removal?.new_value).toBe("");
  });

  it("refuses to resume a rule with an archived project at the field until the project changes", async () => {
    const owner = await createOwner(superuser);
    const project = await owner.project(uniqueCode());
    const rule = await createRule(owner.client, draft({ project: project.id }));
    await setRuleActive(owner.client, rule.id, false);
    await owner.client
      .collection("projects")
      .update(project.id, { archived: true });

    const refused = await dataErrorOf(
      setRuleActive(owner.client, rule.id, true),
    );
    expect(refused.kind).toBe("validation");
    expect(refused.fields.project.code).toBe("validation_project_archived");

    await updateRule(owner.client, rule.id, { project: null });
    expect((await setRuleActive(owner.client, rule.id, true)).active).toBe(
      true,
    );
  });
});

describe("web data layer: a rule from a calendar series (E5 plan, package 6)", () => {
  let superuser;

  beforeAll(async () => {
    superuser = await superuserClient();
  });

  it("converts the entry, then makes the ticket the instance without creating another ticket", async () => {
    const owner = await createOwner(superuser);
    const today = berlinToday(Date.now());
    // A daily series that began a week ago: its first date from today lies within the lead time,
    // so the server would create an instance at once if the ticket did not become one.
    const outcome = await createItem(owner.client, {
      channel: "ics",
      kind: "event",
      title: "Blumen gießen",
      sourceRef: `uid-${uniqueCode()}@example.com`,
      sourceDate: `${addDays(today, -7)} 10:00:00.000Z`,
      sourceMeta: { rrule: "FREQ=DAILY" },
    });
    expect(outcome.kind).toBe("created");
    const item = outcome.item;
    const suggestion = itemSuggestion(item, today);
    expect(suggestion).toMatchObject({ kind: "rule", text: "täglich" });
    const values = suggestionFormValues(suggestion.params);
    expect(values.anchor).toBe(today);

    // Step 1: the ticket, which converts the entry (no due date: P-5).
    const ticket = await createTicket(
      owner.client,
      {
        title: item.title,
        description: "",
        status: "open",
        priority: "medium",
        due: null,
        project: null,
        tags: [],
      },
      { origin: { sourceItem: item.id } },
    );
    const before = await owner.client.collection("tickets").getFullList();
    expect(before.map((entry) => entry.id)).toEqual([ticket.id]);

    // Step 2: the rule with the ticket as its instance.
    const rule = await createRule(
      owner.client,
      {
        title: ticket.title,
        description: ticket.description,
        project: null,
        tags: [],
        priority: ticket.priority,
        ...formParams(values),
      },
      ticket.id,
    );
    const after = await owner.client.collection("tickets").getFullList();
    expect(after.map((entry) => entry.id)).toEqual([ticket.id]);
    expect(await getTicket(owner.client, ticket.id)).toMatchObject({
      recurring: true,
      recurrenceId: rule.id,
      due: today,
      source: "ics",
      sourceItem: item.id,
    });
    expect(rule.nextDue).toBe(addDays(today, 1));
    expect(await getItem(owner.client, item.id)).toMatchObject({
      state: "converted",
      ticketId: ticket.id,
    });
  });

  it("keeps the ticket when the rule is refused", async () => {
    const owner = await createOwner(superuser);
    const ticket = await owner.ticket({ status: "done" });
    const values = suggestionFormValues(
      itemSuggestion(
        {
          sourceDate: "2031-01-06 09:00:00.000Z",
          sourceMeta: { rrule: "FREQ=WEEKLY" },
        },
        "2026-09-25",
      ).params,
    );
    const refused = await dataErrorOf(
      createRule(owner.client, draft(formParams(values)), ticket.id),
    );
    expect(refused.fields.ticket.code).toBe(
      "validation_recurrence_ticket_done",
    );
    expect(await getTicket(owner.client, ticket.id)).toMatchObject({
      id: ticket.id,
      recurring: false,
    });
    expect(await listRules(owner.client)).toEqual([]);
  });
});

describe('web data layer: "Jeden Termin einzeln anlegen" (plan OR-5)', () => {
  it("knows the switch after the migration, even without rules, and keeps its value", async () => {
    const owner = await createOwner(await superuserClient());
    expect(await eachOccurrenceReady(owner.client)).toBe(true);

    const values = { ...defaultFormValues("2033-03-07", "2026-09-28"), eachOccurrence: true };
    const rule = await createRule(owner.client, draft(formParams(values)));
    expect(rule.eachOccurrence).toBe(true);
    expect((await listRules(owner.client)).find((entry) => entry.id === rule.id)?.eachOccurrence).toBe(true);
    const off = await updateRule(owner.client, rule.id, { each_occurrence: false });
    expect(off.eachOccurrence).toBe(false);

    const refused = await dataErrorOf(
      updateRule(owner.client, rule.id, { mode: "after_completion", weekdays: [], each_occurrence: true }),
    );
    expect(refused.fields.each_occurrence?.code).toBe("validation_recurrence_each_mode");
  });
});

// Plan WV, the report of the user: "Wiederholungen erstellen das Folgeticket mit falscher Priorität
// (offen, statt derzeit ausgewähltem Status …)". Every way a rule starts gives the values of its
// ticket (or of the form) to the template and from there to the next ticket, since WV the status
// as well. The template is a snapshot: a later change of the ticket stays with it until the
// template takes it over ("Auch für künftige Tickets übernehmen" writes it with updateRule).
describe("web data layer: from every way a rule starts to the next ticket (plan WV)", () => {
  let superuser;

  beforeAll(async () => {
    superuser = await superuserClient();
  });

  /** After completion, every day, lead time 1: the next ticket appears right after completing. */
  const soon = () =>
    formParams({
      ...defaultFormValues(null, berlinToday(Date.now())),
      mode: "after_completion",
      freq: "daily",
      interval: "1",
      leadDays: "1",
    });

  /** The open tickets of a rule, as the owner sees them. */
  const openOf = (owner, ruleId) =>
    owner.client.collection("tickets").getFullList({
      filter: owner.client.filter("recurrence = {:rule} && status != 'done'", { rule: ruleId }),
    });

  async function templateTicket(owner, data = {}) {
    const project = await owner.project(uniqueCode());
    const tag = await owner.tag(`t-${uniqueCode()}`);
    const ticket = await createTicket(owner.client, {
      title: "Filter wechseln",
      description: "Dunstabzug, **beide** Filter",
      status: "in_progress",
      priority: "urgent",
      due: null,
      project: project.id,
      tags: [tag.id],
      ...data,
    });
    return { ticket, project, tag };
  }

  it('"Wiederholen…" and "Neues Ticket" with "Wiederholen": the next ticket has the values of the ticket', async () => {
    const owner = await createOwner(superuser);
    const { ticket, project, tag } = await templateTicket(owner);
    // The same draft as RecurrenceStore.repeat and repeatCreated send.
    const rule = await createRule(owner.client, { ...templateBody(ticketTemplate(ticket)), ...soon() }, ticket.id);
    expect(rule).toMatchObject({
      title: "Filter wechseln",
      description: "Dunstabzug, **beide** Filter",
      priority: "urgent",
      projectId: project.id,
      tagIds: [tag.id],
      initialStatus: "in_progress",
    });

    await updateTicket(owner.client, ticket.id, { status: "done" });
    const [next] = await openOf(owner, rule.id);
    expect(next).toMatchObject({
      title: "Filter wechseln",
      description: "Dunstabzug, **beide** Filter",
      priority: "urgent",
      status: "in_progress",
      project: project.id,
      tags: [tag.id],
    });
  });

  it('"Neue Regel": the first ticket has the values of the form', async () => {
    const owner = await createOwner(superuser);
    // The SPA offers "Status beim Anlegen" once the server knows it, without any rule.
    expect(await initialStatusReady(owner.client)).toBe(true);
    const project = await owner.project(uniqueCode());
    const today = berlinToday(Date.now());
    const rule = await createRule(
      owner.client,
      draft({
        project: project.id,
        priority: "low",
        initial_status: "backlog",
        freq: "daily",
        weekdays: [],
        anchor: today,
        lead_days: 0,
      }),
    );
    expect(rule).toMatchObject({ priority: "low", initialStatus: "backlog" });
    const [first] = await openOf(owner, rule.id);
    expect(first).toMatchObject({
      title: "Müll rausbringen",
      priority: "low",
      status: "backlog",
      project: project.id,
    });
  });

  it("a series from a calendar: the next ticket has the values of the converted ticket", async () => {
    const owner = await createOwner(superuser);
    const today = berlinToday(Date.now());
    const outcome = await createItem(owner.client, {
      channel: "ics",
      kind: "event",
      title: "Blumen gießen",
      sourceRef: `uid-${uniqueCode()}@example.com`,
      sourceDate: `${today} 10:00:00.000Z`,
      sourceMeta: { rrule: "FREQ=DAILY" },
    });
    const values = suggestionFormValues(itemSuggestion(outcome.item, today).params);
    const ticket = await createTicket(
      owner.client,
      { title: outcome.item.title, description: "", status: "backlog", priority: "high", due: null, project: null, tags: [] },
      { origin: { sourceItem: outcome.item.id } },
    );
    const rule = await createRule(owner.client, { ...templateBody(ticketTemplate(ticket)), ...formParams(values) }, ticket.id);
    expect(rule).toMatchObject({ priority: "high", initialStatus: "backlog" });

    await updateTicket(owner.client, ticket.id, { status: "done" });
    const [next] = await openOf(owner, rule.id);
    expect(next).toMatchObject({ title: "Blumen gießen", priority: "high", status: "backlog", source: "" });
  });

  it("keeps the template as set up until the change of a ticket is taken over", async () => {
    const owner = await createOwner(superuser);
    const { ticket } = await templateTicket(owner, { priority: "medium", status: "open" });
    const rule = await createRule(owner.client, { ...templateBody(ticketTemplate(ticket)), ...soon() }, ticket.id);

    // Changed at the ticket after setting up: only this ticket (the snapshot of the template).
    await updateTicket(owner.client, ticket.id, { priority: "high" });
    await updateTicket(owner.client, ticket.id, { status: "done" });
    const [second] = await openOf(owner, rule.id);
    expect(second).toMatchObject({ priority: "medium", status: "open" });

    // "Auch für künftige Tickets übernehmen" writes the changed field into the template.
    await updateTicket(owner.client, second.id, { priority: "high" });
    const taken = await updateRule(owner.client, rule.id, { priority: "high" });
    expect(taken.priority).toBe("high");
    await updateTicket(owner.client, second.id, { status: "done" });
    const [third] = await openOf(owner, rule.id);
    expect(third).toMatchObject({ priority: "high", status: "open" });
  });
});
