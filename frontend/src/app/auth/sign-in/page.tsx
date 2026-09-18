import type { Metadata } from "next";

import { SignInView } from "src/sections/auth/sign-in-view";

export const metadata: Metadata = { title: "Sign in | Wolf" };

export default function Page() {
  return <SignInView />;
}
