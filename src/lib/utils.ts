export const waitForElement = <T extends HTMLElement>(
  selector: string,
  predicate?: (el: T) => boolean,
  timeout = 10000
): Promise<T | null> => {
  const el = document.querySelector<T>(selector);
  if (el && (!predicate || predicate(el))) return Promise.resolve(el);

  return new Promise((resolve) => {
    let done = false;

    const finish = (result: T | null) => {
      if (done) return;
      done = true;
      mo.disconnect();
      resolve(result);
    };

    const mo = new MutationObserver(() => {
      const el = document.querySelector<T>(selector);
      if (el && (!predicate || predicate(el))) finish(el);
    });

    mo.observe(document.body, { childList: true, subtree: true, attributes: true });
    setTimeout(() => finish(null), timeout);
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
