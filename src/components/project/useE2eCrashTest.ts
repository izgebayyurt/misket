import { useEffect, useRef, useState } from "react";
import { getE2eConfig } from "@/api/e2e";

/**
 * Headless check for the error boundary: launched with `MISKET_E2E_CRASH_TEST`
 * set, throw a frontend error once the app is up. A React error boundary
 * only catches errors raised during render (not inside an effect), so this
 * throws from render instead, once state says to.
 */
export function useE2eCrashTest() {
  const [crash, setCrash] = useState(false);
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void getE2eConfig().then((cfg) => {
      if (cfg.triggerFrontendError) setCrash(true);
    });
  }, []);
  if (crash) {
    throw new Error("MISKET_E2E_CRASH_TEST: intentional test error");
  }
}
