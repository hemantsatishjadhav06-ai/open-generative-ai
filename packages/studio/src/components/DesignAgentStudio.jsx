"use client";

import { usePathname } from 'next/navigation';
import { CreativeCanvas } from 'design-agent';

import { notifyBudgetExceeded, notifySessionRequired } from '../session.js';

// The Design Agent tab: the CreativeCanvas package on Aquora's own design
// agent API (/api/v1/creative-agent/*). The session cookie authenticates
// every request, so nothing is written to browser storage except the flag
// the shell uses to reset the canvas styles when leaving this tab.
// `apiKey` is the shell's workspace identity; the shell remounts this
// component when it changes.
export default function DesignAgentStudio({
  locale: localeProp,
  onGenerationStart,
  onGenerationEnd,
  onGenerationComplete,
  onGenerationError,
  backHref,
  brandSlot,
}) {
  const pathname = usePathname() || '';
  const locale = localeProp || (/^\/zh(\/|$)/.test(pathname) ? 'zh' : 'en');

  if (typeof window !== 'undefined') {
    try {
      sessionStorage.setItem('fromDesignAgent', 'true');
    } catch {
      // storage unavailable: the shell simply skips its style reset
    }
  }

  return (
    <div className="h-full w-full bg-app-bg overflow-hidden design-agent-studio">
      <CreativeCanvas
        theme="dark"
        locale={locale}
        onAuthRequired={notifySessionRequired}
        onBudgetExceeded={notifyBudgetExceeded}
        onGenerationStart={onGenerationStart}
        onGenerationEnd={onGenerationEnd}
        onGenerationComplete={onGenerationComplete}
        onGenerationError={onGenerationError}
        backHref={backHref}
        brandSlot={brandSlot}
      />
    </div>
  );
}
