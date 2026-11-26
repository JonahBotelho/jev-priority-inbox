// Keep a visible demo's account history current and stop its timer when the tab is hidden.
export const historyFreshnessMs = 5 * 60 * 1000;

export function observeDemoHistory(page: EventTarget & { readonly hidden: boolean }, refreshIfStale: () => void) {
  let timer: ReturnType<typeof setInterval> | undefined;

  function visibilityChanged() {
    clearInterval(timer);
    if (page.hidden) return;
    refreshIfStale();
    timer = setInterval(refreshIfStale, historyFreshnessMs);
  }

  page.addEventListener('visibilitychange', visibilityChanged);
  visibilityChanged();
  return () => {
    clearInterval(timer);
    page.removeEventListener('visibilitychange', visibilityChanged);
  };
}
