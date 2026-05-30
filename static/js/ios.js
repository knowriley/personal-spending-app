// MoneyHabits v2 — iOS interaction primitives.
//
// Exposes `window.MoneyHabitsIOS` with the API surface from engineering doc §4.4:
//   openBottomSheet({ content, title?, showHandle?, onDismiss? })
//   closeBottomSheet()
//   openRightFlyout({ content, title?, onDismiss?, compressTarget? })
//   closeRightFlyout()
//   initLargeTitleScroll(scrollContainer, { largeTitle, stickyBar })
//   wireSwipeDismiss(el, direction, threshold, onDismiss) → cleanup fn
//   lockBodyScroll() / unlockBodyScroll()
//
// Behavior specs follow mobile-design §3 (large-title) and §4 (sheet + flyout).
// One active sheet + one active flyout at a time; opening either while one is
// open silently closes the existing one first.

(function () {
  'use strict';

  const EASING_IOS = 'cubic-bezier(0.32, 0.72, 0, 1)';
  const SHEET_MS = 350;
  const BACKDROP_MS = 250;
  const FLYOUT_MS = 350;
  const SWIPE_VELOCITY_THRESHOLD = 0.5;   // pt/ms
  const SWIPE_DOWN_DISTANCE = 100;        // pt
  const SWIPE_RIGHT_DISTANCE = 80;        // pt
  const MOBILE_BREAKPOINT_PX = 768;

  // ── Style injection (one-time) ─────────────────────────────────────────

  const STYLES = `
    .mh-ios-backdrop {
      position: fixed; inset: 0; z-index: 49;
      background: rgba(0, 0, 0, 0.4);
      opacity: 0;
      transition: opacity ${BACKDROP_MS}ms ${EASING_IOS};
    }
    .mh-ios-backdrop[data-open="true"] { opacity: 1; }

    .mh-ios-sheet {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 50;
      background: #ffffff;
      border-top-left-radius: 16px;
      border-top-right-radius: 16px;
      box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.12);
      transform: translateY(100%);
      transition: transform ${SHEET_MS}ms ${EASING_IOS};
      display: flex; flex-direction: column;
      padding-bottom: env(safe-area-inset-bottom);
      touch-action: pan-y;
      max-height: 90dvh;
    }
    .mh-ios-sheet[data-open="true"] { transform: translateY(0); }
    .mh-ios-sheet-handle {
      width: 36px; height: 5px;
      background: #d1d1d6;
      border-radius: 999px;
      margin: 8px auto 0;
      flex-shrink: 0;
    }
    .mh-ios-sheet-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px 16px;
      border-bottom: 1px solid #f2f2f7;
      flex-shrink: 0;
    }
    .mh-ios-sheet-title {
      font: 600 16px -apple-system, system-ui, sans-serif;
      color: #1c1c1e;
    }
    .mh-ios-close-btn {
      width: 44px; height: 44px;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; border: 0; padding: 0;
      color: #8e8e93; cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .mh-ios-sheet-content {
      flex: 1 1 auto; min-height: 0;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding: 16px;
    }

    .mh-ios-flyout {
      position: fixed; top: 0; right: 0; bottom: 0; z-index: 50;
      background: #ffffff;
      width: 100%;
      transform: translateX(100%);
      transition: transform ${FLYOUT_MS}ms ${EASING_IOS};
      display: flex; flex-direction: column;
      box-shadow: -8px 0 32px rgba(0, 0, 0, 0.12);
      touch-action: pan-x;
    }
    .mh-ios-flyout[data-open="true"] { transform: translateX(0); }
    @media (min-width: ${MOBILE_BREAKPOINT_PX}px) {
      .mh-ios-flyout { width: 50%; border-left: 1px solid #e5e5ea; }
    }
    .mh-ios-flyout-header {
      position: sticky; top: 0;
      background: #ffffff;
      display: grid; grid-template-columns: 44px 1fr 44px;
      align-items: center;
      height: 56px;
      border-bottom: 1px solid #e5e5ea;
      padding-top: env(safe-area-inset-top);
      flex-shrink: 0;
      z-index: 1;
    }
    .mh-ios-flyout-back, .mh-ios-flyout-close {
      width: 44px; height: 44px;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; border: 0; padding: 0;
      color: #4338ca; cursor: pointer;
      font: 600 18px -apple-system, system-ui, sans-serif;
      -webkit-tap-highlight-color: transparent;
    }
    .mh-ios-flyout-title {
      font: 600 16px -apple-system, system-ui, sans-serif;
      color: #1c1c1e;
      text-align: center;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .mh-ios-flyout-content {
      flex: 1 1 auto; min-height: 0;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding: 16px;
      padding-bottom: max(16px, env(safe-area-inset-bottom));
    }

    /* .mh-ios-compress is a no-op container hook today — the flyout overlays
       the right edge at every breakpoint instead of pushing content left. The
       class + data-flyout-open attribute are still set so external code can
       observe the open state if needed. */
    .mh-ios-compress {
      transition: width ${FLYOUT_MS}ms ${EASING_IOS};
    }
  `;

  function injectStyles() {
    if (document.getElementById('mh-ios-styles')) return;
    const style = document.createElement('style');
    style.id = 'mh-ios-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  // ── Body scroll lock (ref-counted so nested opens don't double-toggle) ─

  let scrollLockCount = 0;
  let savedBodyOverflow = '';
  let savedScrollY = 0;

  function lockBodyScroll() {
    if (scrollLockCount === 0) {
      savedBodyOverflow = document.body.style.overflow;
      savedScrollY = window.scrollY;
      document.body.style.overflow = 'hidden';
    }
    scrollLockCount++;
  }
  function unlockBodyScroll() {
    if (scrollLockCount === 0) return;
    scrollLockCount--;
    if (scrollLockCount === 0) {
      document.body.style.overflow = savedBodyOverflow;
    }
  }

  // ── Focus management ──────────────────────────────────────────────────

  const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function getFocusable(root) {
    return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR))
      .filter(el => el.offsetParent !== null);   // visible only
  }

  function installFocusTrap(container, returnFocusTo) {
    function onKeydown(e) {
      if (e.key !== 'Tab') return;
      const focusable = getFocusable(container);
      if (focusable.length === 0) { e.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus(); e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus(); e.preventDefault();
      }
    }
    container.addEventListener('keydown', onKeydown);
    const initial = getFocusable(container)[0];
    if (initial) initial.focus();
    return function uninstall() {
      container.removeEventListener('keydown', onKeydown);
      if (returnFocusTo && typeof returnFocusTo.focus === 'function') {
        returnFocusTo.focus();
      }
    };
  }

  // ── Swipe dismiss ──────────────────────────────────────────────────────

  function wireSwipeDismiss(el, direction, threshold, onDismiss) {
    // direction: 'down' | 'right'. Sets el.style.transform while dragging in
    // that direction. On release: dismiss if distance > threshold AND
    // velocity > SWIPE_VELOCITY_THRESHOLD; otherwise snap back.
    const isVertical = direction === 'down';
    let startX = 0, startY = 0, startTime = 0;
    let dragging = false;
    let delta = 0;

    function onStart(e) {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      startTime = performance.now();
      dragging = true;
      delta = 0;
      el.style.transition = 'none';
    }
    function onMove(e) {
      if (!dragging) return;
      const t = e.touches[0];
      const raw = isVertical ? (t.clientY - startY) : (t.clientX - startX);
      delta = Math.max(0, raw);   // only react to the dismiss direction
      const prop = isVertical ? 'translateY' : 'translateX';
      el.style.transform = `${prop}(${delta}px)`;
    }
    function onEnd() {
      if (!dragging) return;
      dragging = false;
      const ms = Math.max(1, performance.now() - startTime);
      const velocity = delta / ms;
      el.style.transition = '';
      if (delta > threshold && velocity > SWIPE_VELOCITY_THRESHOLD) {
        if (onDismiss) onDismiss();
      } else {
        // Snap back
        el.style.transform = '';
      }
    }

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });

    return function cleanup() {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }

  // ── Bottom sheet ──────────────────────────────────────────────────────

  let activeSheet = null;   // { backdrop, sheet, cleanup }

  function openBottomSheet(opts) {
    injectStyles();
    if (activeSheet) closeBottomSheet();

    const { content, title = null, showHandle = true, onDismiss = null } = opts || {};
    const returnFocusTo = document.activeElement;

    const backdrop = document.createElement('div');
    backdrop.className = 'mh-ios-backdrop';

    const sheet = document.createElement('div');
    sheet.className = 'mh-ios-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    if (title) sheet.setAttribute('aria-label', title);

    if (showHandle) {
      const handle = document.createElement('div');
      handle.className = 'mh-ios-sheet-handle';
      sheet.appendChild(handle);
    }

    if (title) {
      const header = document.createElement('div');
      header.className = 'mh-ios-sheet-header';
      const t = document.createElement('span');
      t.className = 'mh-ios-sheet-title';
      t.textContent = title;
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'mh-ios-close-btn';
      close.setAttribute('aria-label', 'Close');
      close.innerHTML = closeIconSvg();
      close.addEventListener('click', () => closeBottomSheet());
      header.appendChild(t);
      header.appendChild(close);
      sheet.appendChild(header);
    }

    const contentEl = document.createElement('div');
    contentEl.className = 'mh-ios-sheet-content';
    if (typeof content === 'string') {
      contentEl.innerHTML = content;
    } else if (content instanceof Node) {
      contentEl.appendChild(content);
    }
    sheet.appendChild(contentEl);

    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);

    // Backdrop tap dismisses
    backdrop.addEventListener('click', () => closeBottomSheet());

    // Swipe-down dismiss on the sheet itself
    const releaseSwipe = wireSwipeDismiss(sheet, 'down', SWIPE_DOWN_DISTANCE, () => closeBottomSheet());

    lockBodyScroll();
    const releaseFocus = installFocusTrap(sheet, returnFocusTo);

    // Animate in (force layout, then flip the open state)
    void sheet.offsetHeight;
    backdrop.dataset.open = 'true';
    sheet.dataset.open = 'true';

    activeSheet = { backdrop, sheet, releaseSwipe, releaseFocus, onDismiss };
  }

  function closeBottomSheet() {
    if (!activeSheet) return;
    const { backdrop, sheet, releaseSwipe, releaseFocus, onDismiss } = activeSheet;
    activeSheet = null;

    backdrop.dataset.open = 'false';
    sheet.dataset.open = 'false';
    sheet.style.transform = '';     // clear any drag-residual transform

    const removeAfter = () => {
      releaseSwipe();
      releaseFocus();
      backdrop.remove();
      sheet.remove();
      unlockBodyScroll();
      if (onDismiss) onDismiss();
    };
    // Wait for the sheet's transform transition; backdrop fades faster but
    // they finish near-simultaneously visually. Use the sheet's transitionend.
    let done = false;
    function once(e) {
      if (e.target !== sheet || e.propertyName !== 'transform') return;
      sheet.removeEventListener('transitionend', once);
      if (done) return;
      done = true;
      removeAfter();
    }
    sheet.addEventListener('transitionend', once);
    // Safety: if transitionend doesn't fire (display:none, prefers-reduced-motion, etc.)
    setTimeout(() => {
      if (done) return;
      sheet.removeEventListener('transitionend', once);
      done = true;
      removeAfter();
    }, SHEET_MS + 100);
  }

  // ── Right flyout ──────────────────────────────────────────────────────

  let activeFlyout = null;   // { flyout, compressTarget, cleanup }

  function openRightFlyout(opts) {
    injectStyles();
    if (activeFlyout) closeRightFlyout();

    const { content, title = '', onDismiss = null, onExpand = null, compressTarget = null } = opts || {};
    const returnFocusTo = document.activeElement;

    const flyout = document.createElement('div');
    flyout.className = 'mh-ios-flyout';
    flyout.setAttribute('role', 'dialog');
    flyout.setAttribute('aria-modal', 'true');
    if (title) flyout.setAttribute('aria-label', title);

    const header = document.createElement('div');
    header.className = 'mh-ios-flyout-header';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'mh-ios-flyout-back';
    back.setAttribute('aria-label', 'Back');
    back.textContent = '←';
    back.addEventListener('click', () => closeRightFlyout());

    const titleEl = document.createElement('span');
    titleEl.className = 'mh-ios-flyout-title';
    titleEl.textContent = title;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'mh-ios-flyout-close';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = closeIconSvg();
    close.addEventListener('click', () => closeRightFlyout());

    header.appendChild(back);
    header.appendChild(titleEl);

    // Optional expand button — caller passes onExpand to get a Notion-style
    // "open as full page" affordance to the left of the close button.
    if (onExpand) {
      const expand = document.createElement('button');
      expand.type = 'button';
      expand.className = 'mh-ios-flyout-close';
      expand.setAttribute('aria-label', 'Open as full page');
      expand.title = 'Open as full page';
      expand.innerHTML = expandIconSvg();
      expand.addEventListener('click', () => {
        // Skip the normal onDismiss path — caller will re-parent the content
        // into its full-page home before/after the flyout tears down.
        const cb = onExpand;
        if (activeFlyout) activeFlyout.onDismiss = null;
        cb(content);
        closeRightFlyout();
      });
      header.style.gridTemplateColumns = '44px 1fr 44px 44px';
      header.appendChild(expand);
    }

    header.appendChild(close);
    flyout.appendChild(header);

    const contentEl = document.createElement('div');
    contentEl.className = 'mh-ios-flyout-content';
    if (typeof content === 'string') {
      contentEl.innerHTML = content;
    } else if (content instanceof Node) {
      contentEl.appendChild(content);
    }
    flyout.appendChild(contentEl);

    document.body.appendChild(flyout);

    if (compressTarget) {
      compressTarget.classList.add('mh-ios-compress');
      compressTarget.dataset.flyoutOpen = 'true';
    }

    // Swipe-right dismisses (mobile)
    const releaseSwipe = wireSwipeDismiss(flyout, 'right', SWIPE_RIGHT_DISTANCE, () => closeRightFlyout());

    // Escape key dismisses (desktop primary, but works everywhere)
    const onKeydown = (e) => { if (e.key === 'Escape') closeRightFlyout(); };
    document.addEventListener('keydown', onKeydown);

    // Click on the compress target (desktop "click outside") dismisses.
    // Install in a microtask so the *opening* click — which is still bubbling
    // up the DOM at this point — doesn't immediately re-trigger and close us.
    // (Bar-chart clicks dodge this because Chart.js dispatches onClick async;
    // SVG-radial clicks fire synchronously and would self-cancel otherwise.)
    let releaseOutsideClick = null;
    if (compressTarget && window.matchMedia(`(min-width: ${MOBILE_BREAKPOINT_PX}px)`).matches) {
      const onClickOutside = (e) => {
        if (compressTarget.contains(e.target) && !flyout.contains(e.target)) {
          closeRightFlyout();
        }
      };
      const armId = setTimeout(() => {
        compressTarget.addEventListener('click', onClickOutside);
      }, 0);
      releaseOutsideClick = () => {
        clearTimeout(armId);
        compressTarget.removeEventListener('click', onClickOutside);
      };
    }

    lockBodyScroll();
    const releaseFocus = installFocusTrap(flyout, returnFocusTo);

    void flyout.offsetHeight;
    flyout.dataset.open = 'true';

    activeFlyout = { flyout, compressTarget, releaseSwipe, releaseFocus,
                     onKeydown, releaseOutsideClick, onDismiss };
  }

  function closeRightFlyout() {
    if (!activeFlyout) return;
    const { flyout, compressTarget, releaseSwipe, releaseFocus,
            onKeydown, releaseOutsideClick, onDismiss } = activeFlyout;
    activeFlyout = null;

    flyout.dataset.open = 'false';
    flyout.style.transform = '';

    if (compressTarget) {
      compressTarget.dataset.flyoutOpen = 'false';
    }

    document.removeEventListener('keydown', onKeydown);
    if (releaseOutsideClick) releaseOutsideClick();

    let done = false;
    function once(e) {
      if (e.target !== flyout || e.propertyName !== 'transform') return;
      flyout.removeEventListener('transitionend', once);
      if (done) return;
      done = true;
      releaseSwipe();
      releaseFocus();
      flyout.remove();
      if (compressTarget) {
        compressTarget.classList.remove('mh-ios-compress');
        delete compressTarget.dataset.flyoutOpen;
      }
      unlockBodyScroll();
      if (onDismiss) onDismiss();
    }
    flyout.addEventListener('transitionend', once);
    setTimeout(() => {
      if (done) return;
      flyout.removeEventListener('transitionend', once);
      done = true;
      releaseSwipe();
      releaseFocus();
      flyout.remove();
      if (compressTarget) {
        compressTarget.classList.remove('mh-ios-compress');
        delete compressTarget.dataset.flyoutOpen;
      }
      unlockBodyScroll();
      if (onDismiss) onDismiss();
    }, FLYOUT_MS + 100);
  }

  // ── Large-title scroll ────────────────────────────────────────────────

  function initLargeTitleScroll(scrollContainer, opts) {
    const { largeTitle, stickyBar, threshold = 60 } = opts || {};
    if (!scrollContainer || !largeTitle || !stickyBar) {
      console.warn('initLargeTitleScroll: missing required element(s)');
      return () => {};
    }

    // Establish initial sticky-bar invisible state
    stickyBar.style.opacity = '0';
    stickyBar.style.pointerEvents = 'none';

    function update() {
      const y = Math.max(0, scrollContainer.scrollTop);
      const progress = Math.min(1, y / threshold);
      largeTitle.style.opacity = String(1 - progress);
      largeTitle.style.transform = `translateY(${-progress * 20}px) scale(${1 - progress * 0.15})`;
      stickyBar.style.opacity = String(progress);
      stickyBar.style.pointerEvents = progress > 0.5 ? 'auto' : 'none';
    }

    update();
    scrollContainer.addEventListener('scroll', update, { passive: true });
    return function cleanup() {
      scrollContainer.removeEventListener('scroll', update);
    };
  }

  // ── Misc ──────────────────────────────────────────────────────────────

  function closeIconSvg() {
    return '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">' +
           '<path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"/>' +
           '</svg>';
  }

  // Arrow-up-right "open as full page" icon used in the flyout chrome.
  function expandIconSvg() {
    return '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
           '<path d="M7 5h8v8"/><path d="M15 5 5 15"/>' +
           '</svg>';
  }

  // ── Public API ────────────────────────────────────────────────────────

  window.MoneyHabitsIOS = {
    openBottomSheet,
    closeBottomSheet,
    openRightFlyout,
    closeRightFlyout,
    initLargeTitleScroll,
    wireSwipeDismiss,
    lockBodyScroll,
    unlockBodyScroll,
  };
})();
