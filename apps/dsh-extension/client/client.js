// Manifold 3D — DeepSeek Harness Client half.
// Registers the right-Sidebar "3D Viewer" tab and the manifold_execute_script
// tool card. The tab body embeds the session's loopback Viewer room and
// inserts Attach references into the composer when the Host asks it to.
window.__ModuleLoader__.load({
  id: '@manifold3d/manifold-dsh',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'manifold3d';
    const TAB_ID = '@manifold3d/manifold-dsh/viewer';
    const TAB_KIND = 'manifold3d-viewer';
    const POLL_RETRY_MS = 2000;

    const zh = {
      'tab.title': '3D 视图',
      'guide.title': 'Manifold 3D 视图',
      'guide.description': '查看当前会话的 3D 模型',
      'viewer.opening': '正在打开 3D 视图…',
      'viewer.retry': '重试',
      'viewer.frame': 'Manifold 3D 视图',
      'card.running': '正在执行建模脚本…',
      'card.succeeded': '模型已生成',
      'card.revision': '修订 {revision}',
      'card.failed': '建模脚本失败',
      'card.open': '在 3D 视图中打开',
    };
    const en = {
      'tab.title': '3D Viewer',
      'guide.title': 'Manifold 3D Viewer',
      'guide.description': "View this session's 3D model",
      'viewer.opening': 'Opening the 3D Viewer…',
      'viewer.retry': 'Retry',
      'viewer.frame': 'Manifold 3D Viewer',
      'card.running': 'Running the modeling script…',
      'card.succeeded': 'Model generated',
      'card.revision': 'Revision {revision}',
      'card.failed': 'Modeling script failed',
      'card.open': 'Open in 3D Viewer',
    };

    function apiUrl(path, query) {
      const url = new URL(`api/manifold3d/${path}`, document.baseURI);
      for (const [key, value] of Object.entries(query || {})) {
        url.searchParams.set(key, value);
      }
      return url;
    }

    async function requestJson(path, init, query) {
      const response = await fetch(apiUrl(path, query), {
        credentials: 'same-origin',
        cache: 'no-store',
        ...init,
        headers: init && init.body ? { 'Content-Type': 'application/json' } : undefined,
      });
      if (response.status === 204) {
        return { status: 204, body: undefined };
      }
      let body;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      if (!response.ok) {
        const message = body && typeof body.error === 'string' ? body.error : `HTTP ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }
      return { status: response.status, body };
    }

    function delay(ms, signal) {
      return new Promise(resolve => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }

    /** Long-poll composer insertions for one open Viewer tab until it unmounts. */
    async function pollInsertions(address, inputActions, signal) {
      while (!signal.aborted) {
        let next;
        try {
          next = await requestJson('insertions', { method: 'GET', signal }, address);
        } catch (error) {
          if (signal.aborted || (error && error.status === 404)) {
            return;
          }
          await delay(POLL_RETRY_MS, signal);
          continue;
        }
        if (!next.body || signal.aborted) {
          continue;
        }
        let ok = false;
        let reason;
        try {
          const span = inputActions.captureInsertion();
          ok = inputActions.insertText(next.body.text, span) === true;
          reason = ok ? undefined : 'The composer is busy; wait for the current message to send.';
        } catch (error) {
          reason = String(error && error.message ? error.message : error);
        }
        try {
          await requestJson('insertions/ack', {
            method: 'POST',
            body: JSON.stringify({ ...address, id: next.body.id, ok, ...(reason ? { error: reason } : {}) }),
          });
        } catch {
          // The Host times the insertion out and reports the failure in the Viewer.
        }
      }
    }

    function ViewerBody(props) {
      const t = props.t;
      const { tab } = props.useTabInfo();
      const sessionId = props.sessionId;
      const inputActions = props.inputActions;
      const [state, setState] = React.useState({ kind: 'opening' });
      const [attempt, setAttempt] = React.useState(0);
      const address = React.useMemo(() => ({ sessionId, tabId: tab.id }), [sessionId, tab.id]);

      React.useEffect(() => {
        const controller = new AbortController();
        setState({ kind: 'opening' });
        requestJson('rooms', { method: 'POST', body: JSON.stringify(address), signal: controller.signal }).then(
          result => {
            if (!controller.signal.aborted) {
              setState({ kind: 'ready', url: result.body.url });
            }
          },
          error => {
            if (!controller.signal.aborted) {
              setState({ kind: 'error', message: String(error && error.message ? error.message : error) });
            }
          },
        );
        return () => controller.abort();
      }, [address, attempt]);

      React.useEffect(() => {
        if (state.kind !== 'ready' || !inputActions) {
          return undefined;
        }
        const controller = new AbortController();
        void pollInsertions(address, inputActions, controller.signal);
        return () => controller.abort();
      }, [state.kind, address, inputActions]);

      React.useEffect(() => {
        const signal = tab.signal;
        if (!signal) {
          return undefined;
        }
        const close = () => {
          void requestJson('rooms', { method: 'DELETE' }, address).catch(() => undefined);
        };
        if (signal.aborted) {
          close();
          return undefined;
        }
        signal.addEventListener('abort', close, { once: true });
        return () => signal.removeEventListener('abort', close);
      }, [tab.signal, address]);

      if (state.kind === 'ready') {
        return h('iframe', {
          key: state.url,
          src: state.url,
          title: t('viewer.frame'),
          referrerPolicy: 'no-referrer',
          sandbox: 'allow-scripts allow-same-origin allow-downloads',
          allow: 'xr-spatial-tracking',
          style: { display: 'block', width: '100%', height: '100%', border: 0, background: 'transparent' },
        });
      }
      return h(
        'div',
        {
          role: state.kind === 'error' ? 'alert' : 'status',
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            height: '100%',
            padding: 24,
            textAlign: 'center',
            color: 'var(--dsw-alias-label-secondary)',
          },
        },
        h('div', null, state.kind === 'error' ? state.message : t('viewer.opening')),
        state.kind === 'error'
          ? h(
              'button',
              {
                type: 'button',
                onClick: () => setAttempt(value => value + 1),
                style: buttonStyle(),
              },
              t('viewer.retry'),
            )
          : null,
      );
    }

    function buttonStyle() {
      return {
        font: 'inherit',
        fontSize: 13,
        lineHeight: '20px',
        padding: '4px 12px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
      };
    }

    function parseResult(block) {
      const content = Array.isArray(block && block.content) ? block.content : [];
      const text = content
        .filter(item => item && item.type === 'text' && typeof item.text === 'string')
        .map(item => item.text)
        .join('\n');
      const start = text.indexOf('{');
      if (start < 0) {
        return { text };
      }
      try {
        return { text, body: JSON.parse(text.slice(start)) };
      } catch {
        return { text };
      }
    }

    function ExecuteCard(props) {
      const t = props.t;
      const sidebarRight = props.manifoldSidebarRight;
      const done = props.phase === 'result';
      const failed = done && props.block && props.block.isError === true;
      const result = done ? parseResult(props.block) : undefined;
      const revision = result && result.body && result.body.modelRevision;
      const firstError =
        result && result.body && Array.isArray(result.body.errors) && result.body.errors[0]
          ? result.body.errors[0].message
          : result && result.body && result.body.message;
      const color = failed
        ? 'var(--dsw-alias-state-error-primary)'
        : done
          ? 'var(--dsw-alias-state-success-primary)'
          : 'var(--dsw-alias-state-idle-primary)';
      return h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px',
            margin: '4px 0',
            borderRadius: 12,
            border: '1px solid var(--dsw-alias-border-l1)',
            background: 'var(--dsw-alias-bg-layer-1)',
            color: 'var(--dsw-alias-label-primary)',
            fontSize: 13,
          },
        },
        h('span', {
          'aria-hidden': true,
          style: { width: 8, height: 8, borderRadius: 4, background: color, flex: 'none' },
        }),
        h(
          'div',
          { style: { flex: 1, minWidth: 0 } },
          h('div', null, failed ? t('card.failed') : done ? t('card.succeeded') : t('card.running')),
          done && !failed && typeof revision === 'number'
            ? h(
                'div',
                { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } },
                t('card.revision').replace('{revision}', String(revision)),
              )
            : null,
          failed && firstError
            ? h(
                'div',
                {
                  style: {
                    color: 'var(--dsw-alias-label-secondary)',
                    fontSize: 12,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                  title: String(firstError),
                },
                String(firstError),
              )
            : null,
        ),
        done && !failed
          ? h(
              'button',
              { type: 'button', style: buttonStyle(), onClick: () => sidebarRight.openTab(TAB_KIND) },
              t('card.open'),
            )
          : null,
      );
    }

    return {
      inject: ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'manifold3d: locale');
        ctx.effect(
          () =>
            ctx.sidebarRightTabs.register({
              id: TAB_ID,
              kind: TAB_KIND,
              title: () => t('tab.title'),
              guide: [
                {
                  id: 'viewer',
                  order: 60,
                  title: () => t('guide.title'),
                  description: () => t('guide.description'),
                },
              ],
            }),
          'manifold3d: tab type',
        );
        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.right.pane.tab', () =>
              ctx.slots.register(
                {
                  name: 'sidebar.right.pane.tab',
                  key: TAB_ID,
                  locale: NS,
                  inject: sessionId => ({ sessionId, t }),
                },
                ViewerBody,
              ),
            ),
          'manifold3d: tab body',
        );
        ctx.effect(
          () =>
            ctx.slots.inject('tool.call.toolview', () =>
              ctx.slots.register({ name: 'tool.call.toolview', key: 'manifold_execute_script' }, props =>
                h(ExecuteCard, { ...props, t, manifoldSidebarRight: ctx.sidebarRight }),
              ),
            ),
          'manifold3d: execute card',
        );
      },
    };
  },
});
