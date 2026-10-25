// Compatibility path for the root layout (worker 15 owns layout wiring). The shell lives in
// @/features/shell; it needs WalletConnectionProvider inside the QueryClientProvider above it.
export { AppShell } from "@/features/shell";
