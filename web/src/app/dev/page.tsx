import Link from "next/link";

const LEGACY = [
  { href: "/dev/legacy/forecast", label: "Forecast (legacy raw view)" },
  { href: "/dev/legacy/planner", label: "Planner (legacy raw view)" },
];

const SESSION_VIEWS = ["path", "results", "seller", "activity"] as const;

export default function DevIndex() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Developer console</h1>
      <p>Legacy raw views snapshotted from the original frontend. Session views take a session address: /dev/legacy/session/&lt;addr&gt;/{SESSION_VIEWS.join("|")}.</p>
      <ul>
        {LEGACY.map((l) => (
          <li key={l.href}>
            <Link href={l.href}>{l.label}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
