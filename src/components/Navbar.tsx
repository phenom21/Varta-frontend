"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "./ui/Button";
import { useAuth } from "@/components/providers/AuthProvider";
import Image from "next/image";

export default function Navbar() {
  const pathname = usePathname();
  const { isAuthed, logout } = useAuth();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-emerald-500/10 bg-black/70 backdrop-blur supports-[backdrop-filter]:bg-black/50">
      <div className="mx-auto max-w-8xl px-12 sm:px-6 lg:px-20 h-20 flex items-center justify-between">
        <Link href="/" className="flex items-center">
          <Image
            src="/varta-logo.png"
            alt="Varta"
            width={110}
            height={28}
            className="h-6 w-auto"
            priority
          />
        </Link>
        <nav className="hidden sm:flex items-center gap-3">
          {!mounted || !isAuthed ? (
            <>
              <Link href="/login">
                <Button className="h-9 px-4" variant="secondary">Login</Button>
              </Link>
              <Link href="/signup">
                <Button className="h-9 px-4" variant="primary">Sign up</Button>
              </Link>
            </>
          ) : (
            <>
              <Button className="h-9 px-4" variant="secondary" onClick={logout}>Logout</Button>
            </>
          )}
        </nav>
        <nav className="sm:hidden">
          {!mounted || !isAuthed ? (
            pathname !== "/signup" ? (
              <Link href="/signup">
                <Button className="h-9 px-4" variant="primary">Sign up</Button>
              </Link>
            ) : (
              <Link href="/login">
                <Button className="h-9 px-4" variant="secondary">Login</Button>
              </Link>
            )
          ) : (
            <Button className="h-9 px-4" variant="secondary" onClick={logout}>Logout</Button>
          )}
        </nav>
      </div>
    </header>
  );
}
