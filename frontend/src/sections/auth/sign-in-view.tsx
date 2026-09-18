"use client";

import { useState } from "react";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Stack from "@mui/material/Stack";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { useRouter, useSearchParams } from "src/routes/hooks";

export function SignInView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo") ?? "/dashboard/evidence";
  const [email, setEmail] = useState("buyer@demo.local");
  const [password, setPassword] = useState("wolf-demo");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/sign-in/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sign in failed");
      router.replace(returnTo);
      router.refresh();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: 2,
      }}
    >
      <Card sx={{ p: 4, width: "100%", maxWidth: 420 }}>
        <Stack spacing={2}>
          <Typography variant="h4">Sign in</Typography>
          <Typography variant="body2" color="text.secondary">
            Procurement evidence · local workshop demo
          </Typography>
          <TextField
            label="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            fullWidth
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
          {error && <Alert severity="error">{error}</Alert>}
          <Button variant="contained" disabled={busy} onClick={() => void submit()}>
            Sign in
          </Button>
          <Alert severity="info">
            Demo account: <strong>buyer@demo.local</strong> /{" "}
            <strong>wolf-demo</strong>
          </Alert>
          <Typography variant="body2">
            No account?{" "}
            <a href="/auth/sign-up" style={{ color: "inherit" }}>
              Create one
            </a>
          </Typography>
        </Stack>
      </Card>
    </Box>
  );
}
