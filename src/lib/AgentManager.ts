import { loadState, updateState, subscribeToState } from './storage';
import type { Agent, AppState } from './types';

const waitForElement = <T extends HTMLElement>(
  selector: string,
  predicate?: (el: T) => boolean,
  timeout = 10000
): Promise<T | null> => {
  const el = document.querySelector<T>(selector);
  if (el && (!predicate || predicate(el))) return Promise.resolve(el);

  return new Promise((resolve) => {
    const deadline = Date.now() + timeout;
    const mo = new MutationObserver(() => {
      const el = document.querySelector<T>(selector);
      if (el && (!predicate || predicate(el))) {
        mo.disconnect();
        resolve(el);
      } else if (Date.now() > deadline) {
        mo.disconnect();
        resolve(null);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  });
};

const waitForCondition = (
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

export class AgentManager {
  private static instance: AgentManager;
  private sidebarObserver: MutationObserver | null = null;
  private currentUrl = location.href;
  private localState: AppState = { agents: [], sessions: {}, activeAgentId: null };
  private filterRAF = 0;
  private isAutoFilling = false;

  private sidebarContainer: HTMLElement | null = null;
  private cachedLinks: HTMLElement[] = [];
  private cachedGroups: HTMLElement[] = [];
  private filterDirty = true;

  private constructor() {
    this.init();
  }

  static getInstance() {
    if (!AgentManager.instance) {
      AgentManager.instance = new AgentManager();
    }
    return AgentManager.instance;
  }

  private async init() {
    this.localState = await loadState();
    subscribeToState((newState) => {
      this.localState = newState;
      this.filterDirty = true;
      this.scheduleFilterHistory();
    });
    this.interceptFetch();
    this.interceptHistory();
    this.observeSidebar();
    this.handleUrlChange();
  }

  /**
   * Intercept DeepSeek's fetch_page API to filter sessions at the source.
   * When agent mode is active: only return sessions belonging to that agent.
   * When no agent: exclude sessions belonging to any agent.
   * This prevents DeepSeek from rendering hundreds of irrelevant DOM nodes.
   */
  private interceptFetch() {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
      const response = await originalFetch(...args);
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url;

      if (!url?.includes('chat_session/fetch_page')) {
        return response;
      }

      const { activeAgentId, sessions } = this.localState;
      if (!activeAgentId && Object.keys(sessions).length === 0) {
        return response;
      }

      try {
        const json = await response.json();
        const bizData = json.data?.biz_data;
        if (!bizData?.chat_sessions) return new Response(JSON.stringify(json), { status: response.status, headers: response.headers });

        const allAgentSessionIds = new Set(Object.keys(sessions));

        if (activeAgentId) {
          const agentSessionIds = new Set<string>();
          for (const [sId, aId] of Object.entries(sessions)) {
            if (aId === activeAgentId) agentSessionIds.add(sId);
          }
          bizData.chat_sessions = bizData.chat_sessions.filter(
            (s: { id: string }) => agentSessionIds.has(s.id)
          );
        } else {
          bizData.chat_sessions = bizData.chat_sessions.filter(
            (s: { id: string }) => !allAgentSessionIds.has(s.id)
          );
        }

        return new Response(JSON.stringify(json), { status: response.status, headers: response.headers });
      } catch {
        return response;
      }
    };
  }

  private interceptHistory() {
    const checkUrl = () => {
      if (this.currentUrl !== location.href) {
        this.currentUrl = location.href;
        this.handleUrlChange();
      }
    };

    window.addEventListener('popstate', checkUrl);

    const origPush = history.pushState.bind(history);
    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      origPush(...args);
      checkUrl();
    };

    const origReplace = history.replaceState.bind(history);
    history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
      origReplace(...args);
      checkUrl();
    };
  }

  private async handleUrlChange() {
    const isNewChat = location.pathname === '/';
    const match = location.pathname.match(/\/a\/chat\/s\/([a-zA-Z0-9-]+)/);
    const sessionId = match ? match[1] : null;

    if (isNewChat) {
      if (this.localState.activeAgentId) {
        const agent = this.localState.agents.find(a => a.id === this.localState.activeAgentId);
        if (agent) {
          this.autoFillAndSend(agent);
        }
      }
    } else if (sessionId && this.localState.activeAgentId) {
      if (this.localState.sessions[sessionId] !== this.localState.activeAgentId) {
        await updateState(s => {
          s.sessions[sessionId] = this.localState.activeAgentId!;
          return s;
        });
      }
    }

    this.filterDirty = true;
    this.scheduleFilterHistory();
  }

  private clickNewChatOrRedirect() {
    const newChatBtn = document.evaluate(
      '//div[contains(text(), "开启新对话") or contains(text(), "New chat")]',
      document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
    ).singleNodeValue as HTMLElement;

    if (newChatBtn) {
      newChatBtn.click();
    } else {
      location.href = '/';
    }
  }

  public async startAgentChat(agentId: string) {
    this.localState.activeAgentId = agentId;
    await updateState(s => {
      s.activeAgentId = agentId;
      const agent = s.agents.find(a => a.id === agentId);
      if (agent) agent.lastUsed = Date.now();
      return s;
    });

    if (location.pathname !== '/') {
      this.clickNewChatOrRedirect();
    } else {
      const agent = this.localState.agents.find(a => a.id === agentId);
      if (agent) this.autoFillAndSend(agent);
    }
  }

  public async deactivateAgent() {
    this.localState.activeAgentId = null;
    await updateState(s => {
      s.activeAgentId = null;
      return s;
    });

    this.clickNewChatOrRedirect();
    this.filterDirty = true;
    this.scheduleFilterHistory();
  }

  private async autoFillAndSend(agent: Agent) {
    if (this.isAutoFilling) return;
    this.isAutoFilling = true;

    try {
      const textarea = await waitForElement<HTMLTextAreaElement>(
        '#chat-input, textarea',
        el => !el.disabled,
        10000
      );
      if (!textarea) return;

      if (agent.files && agent.files.length > 0) {
        await this.attachFiles(textarea, agent.files);
        await waitForCondition(() => !textarea.disabled, 5000);
      }

      this.injectPrompt(textarea, agent);
    } finally {
      this.isAutoFilling = false;
    }
  }

  private async attachFiles(textarea: HTMLTextAreaElement, files: Agent['files']) {
    if (!files) return;
    try {
      const dataTransfer = new DataTransfer();
      let addedFiles = 0;

      const containerText = textarea.closest('div.flex')?.parentElement?.textContent || '';

      for (const fileData of files) {
        if (containerText.includes(fileData.name)) {
          console.log(`File ${fileData.name} seems already attached, skipping.`);
          continue;
        }
        const res = await fetch(fileData.dataURL);
        const blob = await res.blob();
        const file = new File([blob], fileData.name, { type: fileData.type });
        dataTransfer.items.add(file);
        addedFiles++;
      }

      if (addedFiles > 0) {
        const dropTarget = textarea.closest('div.flex') || document.body;
        const dropEvent = new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dataTransfer
        });
        dropTarget.dispatchEvent(dropEvent);
      }
    } catch (e) {
      console.error('Failed to attach files:', e);
    }
  }

  private injectPrompt(textarea: HTMLTextAreaElement, agent: Agent) {
    const finalPrompt = agent.prompt || '';

    if (finalPrompt) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      nativeInputValueSetter?.call(textarea, finalPrompt);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const tryClickSend = () => {
      const wrapper = textarea.closest('div:has(> div > textarea)');
      if (wrapper) {
        const btn = wrapper.querySelector('div[cursor="pointer"]:last-child') as HTMLElement;
        if (btn && !btn.hasAttribute('disabled')) { btn.click(); return true; }
      }
      const possibleBtn = document.querySelector('div.send-button, div[aria-label="Send message"]') as HTMLElement;
      if (possibleBtn && !possibleBtn.hasAttribute('disabled')) { possibleBtn.click(); return true; }
      return false;
    };

    if (!tryClickSend()) {
      waitForElement<HTMLElement>(
        'div[cursor="pointer"]:last-child, div.send-button, div[aria-label="Send message"]',
        el => !el.hasAttribute('disabled'),
        5000
      ).then(el => el?.click());
    }
  }

  private observeSidebar() {
    const findContainer = (): HTMLElement | null => {
      const link = document.querySelector('a[href*="/a/chat/s/"]');
      if (!link) return null;
      let el = link.parentElement;
      while (el && el !== document.body) {
        if (el.scrollHeight > el.clientHeight && el.querySelector('a[href*="/a/chat/s/"]')) {
          return el;
        }
        el = el.parentElement;
      }
      return link.closest('nav') || link.parentElement?.parentElement || null;
    };

    const startObserving = (container: HTMLElement) => {
      this.sidebarContainer = container;
      this.sidebarObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'childList' && m.addedNodes.length > 0) {
            this.filterDirty = true;
            break;
          }
        }
        if (this.filterDirty) {
          this.scheduleFilterHistory();
        }
      });
      this.sidebarObserver.observe(container, { childList: true, subtree: true });
    };

    const container = findContainer();
    if (container) {
      startObserving(container);
    } else {
      const tempMo = new MutationObserver(() => {
        const container = findContainer();
        if (container) {
          tempMo.disconnect();
          startObserving(container);
          this.filterDirty = true;
          this.scheduleFilterHistory();
        }
      });
      tempMo.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => tempMo.disconnect(), 15000);
    }
  }

  private scheduleFilterHistory() {
    if (this.filterRAF) return;
    this.filterRAF = requestAnimationFrame(() => {
      this.filterRAF = 0;
      this.filterHistoryDOM();
    });
  }

  private resolveCachedLinks() {
    if (!this.filterDirty) return;

    const scope = this.sidebarContainer || document.body;
    const links = scope.querySelectorAll('a[href*="/a/chat/s/"]');

    this.cachedLinks = [];
    this.cachedGroups = [];

    for (const link of links) {
      this.cachedLinks.push(link as HTMLElement);

      const parent = link.parentElement;
      if (parent && !this.cachedGroups.includes(parent) &&
        Array.from(parent.children).some(c => c.tagName === 'DIV')) {
        this.cachedGroups.push(parent);
      }
    }

    this.filterDirty = false;
  }

  /**
   * CSS-level filter as a safety net for edge cases the API interceptor misses
   * (e.g., sessions added after initial load, race conditions).
   * With the API interceptor active, this typically has very little to do.
   */
  public filterHistoryDOM() {
    const { activeAgentId, sessions } = this.localState;

    this.resolveCachedLinks();
    if (this.cachedLinks.length === 0) return;

    const allAgentSessionIds = new Set(Object.keys(sessions));
    const currentAgentSessionIds = new Set<string>();
    if (activeAgentId) {
      for (const [sId, aId] of Object.entries(sessions)) {
        if (aId === activeAgentId) currentAgentSessionIds.add(sId);
      }
    }

    const groupVisibleCounts = new Map<HTMLElement, number>();

    for (const link of this.cachedLinks) {
      const match = link.getAttribute('href')?.match(/\/a\/chat\/s\/([a-zA-Z0-9-]+)/);
      const sessionId = match?.[1];
      if (!sessionId) continue;

      const isVisible = activeAgentId
        ? currentAgentSessionIds.has(sessionId)
        : !allAgentSessionIds.has(sessionId);

      const isCurrentlyHidden = link.style.display === 'none';
      if (isVisible === isCurrentlyHidden) {
        link.style.display = isVisible ? '' : 'none';
        link.classList.toggle('agent-hidden', !isVisible);
      }

      if (isVisible) {
        const parent = link.parentElement;
        if (parent && this.cachedGroups.includes(parent)) {
          groupVisibleCounts.set(parent, (groupVisibleCounts.get(parent) || 0) + 1);
        }
      }
    }

    for (const container of this.cachedGroups) {
      const visibleCount = groupVisibleCounts.get(container) || 0;
      const shouldHide = visibleCount === 0;
      if ((container.style.display === 'none') !== shouldHide) {
        container.style.display = shouldHide ? 'none' : '';
      }
    }
  }

}
