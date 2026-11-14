"use client";

import { useEffect, useState } from "react";
import { Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// "Add to Home Screen" for Mark Attendance: an app icon that opens this page directly - also with no internet
// (public/sw.js). Android Chrome / Edge offer a real install prompt; iPhone Safari and computers can't be prompted by
// a website, so they get the two steps to do it by hand. Hidden once it runs from the home screen, or when closed.

interface InstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }

const HIDE_KEY = "attendance_home_screen_hidden_v1";

export function AddToHomeScreen() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [show, setShow] = useState(false);
  const [help, setHelp] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | "desktop">("desktop");

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    let hidden = false;
    try { hidden = localStorage.getItem(HIDE_KEY) === "1"; } catch { /* blocked storage: show it */ }
    const ua = navigator.userAgent;
    setPlatform(/iphone|ipad|ipod/i.test(ua) ? "ios" : /android/i.test(ua) ? "android" : "desktop");
    setShow(!standalone && !hidden);
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as InstallPrompt); };
    const onInstalled = () => setShow(false);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!show) return null;

  async function add() {
    if (!prompt) { setHelp((h) => !h); return; }
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    setPrompt(null);
    if (outcome === "accepted") setShow(false);
  }

  function close() {
    setShow(false);
    try { localStorage.setItem(HIDE_KEY, "1"); } catch { /* blocked storage */ }
  }

  return (
    <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 shrink-0" />
          Add Mark Attendance to your home screen to open it in one tap, even with no internet.
        </span>
        <div className="flex items-center gap-1">
          <Button size="sm" onClick={() => void add()}>{prompt ? "Add to Home Screen" : "How to Add"}</Button>
          <Button size="sm" variant="ghost" aria-label="Close" onClick={close}><X className="h-4 w-4" /></Button>
        </div>
      </div>
      {help && !prompt && (
        <ol className="list-decimal space-y-0.5 pl-5 text-xs">
          {platform === "ios" ? (
            <>
              <li>Open this page in Safari and tap the Share button (the square with an arrow).</li>
              <li>Tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
            </>
          ) : platform === "android" ? (
            <>
              <li>Tap the browser menu (the three dots at the top right).</li>
              <li>Tap <strong>Add to Home screen</strong> (or <strong>Install app</strong>), then <strong>Add</strong>.</li>
            </>
          ) : (
            <>
              <li>Press <strong>Ctrl + D</strong> (Windows) or <strong>Cmd + D</strong> (Mac) to bookmark this page.</li>
              <li>Or, in Chrome or Edge, use the install icon at the right end of the address bar.</li>
            </>
          )}
          <li>Open Mark Attendance once with internet each day if you can; it then works without a connection.</li>
        </ol>
      )}
    </div>
  );
}
