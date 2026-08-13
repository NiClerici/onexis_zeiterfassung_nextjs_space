import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: {
    signIn: "/login",
  },
});

export const config = {
  matcher: ["/calendar/:path*", "/analytics/:path*", "/profile/:path*", "/set-password/:path*"],
};
