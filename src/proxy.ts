import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Signed-out visitors cannot load the app pages at all. This is a convenience
// redirect, not the security boundary: every Convex function checks the caller itself.
const isAppRoute = createRouteMatcher(["/app(.*)"]);

export default clerkMiddleware(async (auth, request) => {
  if (isAppRoute(request)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
