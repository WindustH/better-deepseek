export const waitForElement = <T extends HTMLElement>(
  selector: string,
  predicate?: (el: T) => boolean,
  timeout = 10000
): Promise<T | null> => {
  const el = document.querySelector<T>(selector);
  if (el && (!predicate || predicate(el))) return Promise.resolve(el);

  return new Promise((resolve) => {
    const deadline = Date.now() + timeout;
    let resolved = false;

    const check = () => {
      if (resolved) return;
      const el = document.querySelector<T>(selector);
      if (el && (!predicate || predicate(el))) {
        resolved = true;
        mo.disconnect();
        resolve(el);
      } else if (Date.now() > deadline) {
        resolved = true;
        mo.disconnect();
        resolve(null);
      }
    };

    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true });

    const poll = () => {
      if (resolved) return;
      check();
      if (!resolved) requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
};

export const waitForCondition = (
  fn: () => boolean,
  timeout = 10000
): Promise<boolean> => {
  if (fn()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const deadline = Date.now() + timeout;
    const check = () => {
      if (fn()) { resolve(true); return; }
      if (Date.now() > deadline) { resolve(false); return; }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
};
