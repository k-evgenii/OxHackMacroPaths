import { NextResponse } from "next/server";

// The legacy research/account viewer is an operator surface, hidden in demo builds.
export function middleware() {
  if (process.env.DEV_CONSOLE !== "1")
    return new NextResponse("Not found", { status: 404 });
  return NextResponse.next();
}
export const config = {
  matcher: [
    "/dev/:path*",
    "/session/:path*",
    "/forecast/:path*",
    "/planner/:path*",
  ],
};
