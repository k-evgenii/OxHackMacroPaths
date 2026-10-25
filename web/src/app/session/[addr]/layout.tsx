// Page-local structure only: the application shell, wallet provider and navigation come from the root.
export default function SessionLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
