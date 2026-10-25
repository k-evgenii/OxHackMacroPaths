// "Choose by goal": plain-English goals mapped to exact sides.
// Order of a preset: [cooling_more, cooling_less, excess_more, excess_less], in PLAY.
// Mapping follows research/products.py (who sits on each side) on the team repo.
import type { Amounts } from "./demoData";

export type Goal = {
  key: string;
  label: string; // the button, first person
  detail: string; // one line: what it pays on
  who: string; // the customer this fits
  preset: Amounts;
};

export const GOALS: Goal[] = [
  {
    key: "hot",
    label: "Sustained inflation",
    detail: "Pays more the longer inflation stays above 4%.",
    who: "Savers, firms with rising costs",
    preset: [0, 0, 10, 0],
  },
  {
    key: "sticky",
    label: "Higher for longer",
    detail: "Pays when inflation overshoots and won't come down.",
    who: "Tenants and SMEs with CPI-linked rent",
    preset: [0, 10, 10, 0],
  },
  {
    key: "cools",
    label: "A sharp cool-down",
    detail: "Pays by how far inflation falls from its peak.",
    who: "Inflation-linked bondholders",
    preset: [10, 0, 0, 0],
  },
  {
    key: "income",
    label: "Cooling without the heat",
    detail: "Pays if inflation drops sharply or never overshoots.",
    who: "Landlords and lenders with CPI-indexed income",
    preset: [10, 0, 0, 10],
  },
  {
    key: "path",
    label: "A spike, then a fall",
    detail: "Pays on the overshoot and on the cooling after it.",
    who: "Anyone with a view on the whole path",
    preset: [10, 0, 10, 0],
  },
];

export const sameAmounts = (a: Amounts, b: Amounts) =>
  a.every((v, i) => v === b[i]);
export const goalFor = (a: Amounts) =>
  GOALS.find((g) => sameAmounts(g.preset, a)) ?? null;

// Personas shown on Home (who MacroPaths is for), each linked to a goal.
export const PERSONAS: { title: string; worry: string; goal: string }[] = [
  {
    title: "Tenant or small business",
    worry: "“Two years above 4% and my CPI-linked rent compounds.”",
    goal: "sticky",
  },
  {
    title: "Landlord or lender",
    worry: "“If inflation drops off a cliff, my indexed income shrinks.”",
    goal: "income",
  },
  {
    title: "Inflation-linked bondholder",
    worry: "“I bought linkers near the peak. A fast cool-down hurts.”",
    goal: "cools",
  },
  {
    title: "Saver or treasurer",
    worry: "“Every month above 4% quietly eats my real return.”",
    goal: "hot",
  },
];
