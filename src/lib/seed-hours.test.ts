import { describe, expect, it } from "vitest";
import { dayHoursText, hoursSummary, parseSeedHours } from "./seed-hours";

const W = {
  closed: "Closed",
  allDay: "Open 24 hours",
  everyDay: "Every day",
  days: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};
const week = (f: (d: string) => string) =>
  ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    .map((d) => `${d}: ${f(d)}`)
    .join(" | ");

describe("seed opening hours (DECISIONS §39.3)", () => {
  it("parses the seed file's format into 24-hour times", () => {
    const p = parseSeedHours(week(() => "8 AM to 8 PM"))!;
    expect(p.size).toBe(7);
    expect(p.get(1)).toEqual({ ranges: [["08:00", "20:00"]] });
  });
  it("handles midnight, noon, minutes, a start without AM/PM, split days, 24 hours and closed days", () => {
    const p = parseSeedHours(
      "Monday: 12 to 10 PM | Tuesday: 9:30 AM to 12 AM | Wednesday: 8 AM to 2 PM, 5 to 11 PM | Thursday: Open 24 hours | Friday: Closed | Saturday: 11 AM to 2 AM | Sunday: 12 PM to 12 AM",
    )!;
    expect(p.get(1)).toEqual({ ranges: [["12:00", "22:00"]] });
    expect(p.get(2)).toEqual({ ranges: [["09:30", "00:00"]] });
    expect(p.get(3)).toEqual({
      ranges: [
        ["08:00", "14:00"],
        ["17:00", "23:00"],
      ],
    });
    expect(p.get(4)).toEqual({ allDay: true });
    expect(p.get(5)).toEqual({ closed: true });
    expect(p.get(6)).toEqual({ ranges: [["11:00", "02:00"]] });
    expect(p.get(0)).toEqual({ ranges: [["12:00", "00:00"]] });
    expect(dayHoursText(p.get(3), W)).toBe("08:00–14:00, 17:00–23:00");
    expect(dayHoursText(p.get(5), W)).toBe("Closed");
  });
  it("accepts the narrow spaces Google puts before AM/PM", () => {
    expect(parseSeedHours("Monday: 8\u202fAM to 8\u202fPM")?.get(1)).toEqual({
      ranges: [["08:00", "20:00"]],
    });
  });
  it("returns null for missing or unknown formats, so the page shows the text as written", () => {
    expect(parseSeedHours(null)).toBeNull();
    expect(parseSeedHours("")).toBeNull();
    expect(parseSeedHours("Lundi: 8h à 20h")).toBeNull();
    expect(parseSeedHours("Monday: whenever")).toBeNull();
    expect(parseSeedHours("Monday: 8 AM to 8 PM | Monday: Closed")).toBeNull();
  });
  it("summarises the week for a card", () => {
    expect(
      hoursSummary(
        week(() => "8 AM to 8 PM"),
        W,
      ),
    ).toBe("Every day 08:00–20:00");
    expect(
      hoursSummary(
        week((d) => (d === "Sunday" ? "Closed" : "8 AM to 10 PM")),
        W,
      ),
    ).toBe("Mon–Sat 08:00–22:00 · Sun Closed");
    expect(
      hoursSummary(
        week((d) => (d === "Friday" ? "Closed" : "Open 24 hours")),
        W,
      ),
    ).toBe("Mon–Thu Open 24 hours · Fri Closed · Sat–Sun Open 24 hours");
    // A day missing from the text counts as closed.
    expect(hoursSummary("Monday: 8 AM to 8 PM", W)).toBe("Mon 08:00–20:00 · Tue–Sun Closed");
    expect(hoursSummary("not hours", W)).toBeNull();
  });
});
