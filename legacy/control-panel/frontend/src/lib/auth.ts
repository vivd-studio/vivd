import { useQuery } from "@tanstack/react-query";

export type ControlPanelUser = {
  id: string;
  email: string;
  name: string;
  role?: string;
};

export type ControlPanelSession = {
  session: {
    id: string;
  };
  user: ControlPanelUser;
};

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string; error?: string };
    return data.message || data.error || JSON.stringify(data);
  } catch {
    try {
      return await res.text();
    } catch {
      return `Request failed with status ${res.status}`;
    }
  }
}

export async function getSession(): Promise<ControlPanelSession | null> {
  const res = await fetch("/auth/get-session", {
    method: "GET",
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }

  return (await res.json()) as ControlPanelSession | null;
}

export function useSession() {
  return useQuery({
    queryKey: ["auth", "session"],
    queryFn: getSession,
    retry: false,
    staleTime: 15_000,
  });
}

export async function signInWithEmail(input: {
  email: string;
  password: string;
}): Promise<void> {
  const res = await fetch("/auth/sign-in/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      email: input.email,
      password: input.password,
    }),
  });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
}

export async function signUpWithEmail(input: {
  name: string;
  email: string;
  password: string;
}): Promise<void> {
  const res = await fetch("/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      name: input.name,
      email: input.email,
      password: input.password,
    }),
  });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
}

export async function signOut(): Promise<void> {
  const res = await fetch("/auth/sign-out", {
    method: "POST",
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
}

