(function () {
  "use strict";

  window.MSH = window.MSH || {};

  const MAX_FOCUS = 4;

  /**
   * Alterna o estado de foco de uma live dentro da lista de streams.
   * Não modifica o array original — retorna um novo array.
   */
  function toggleFocus(streams, streamId) {
    const target = streams.find((s) => s.id === streamId);
    if (!target) {
      return { streams, ok: false, reason: "Live não encontrada." };
    }

    const currentlyFocusedCount = streams.filter((s) => s.focused).length;

    if (target.focused) {
      const updated = streams.map((s) =>
        s.id === streamId ? { ...s, focused: false } : s
      );
      return { streams: updated, ok: true };
    }

    if (currentlyFocusedCount >= MAX_FOCUS) {
      return {
        streams,
        ok: false,
        reason: `Você só pode focar até ${MAX_FOCUS} lives ao mesmo tempo.`,
      };
    }

    const updated = streams.map((s) =>
      s.id === streamId ? { ...s, focused: true } : s
    );
    return { streams: updated, ok: true };
  }

  function isFocusModeActive(streams) {
    return streams.some((s) => s.focused);
  }

  function splitFocusedStreams(streams) {
    const focused = streams.filter((s) => s.focused);
    const others = streams.filter((s) => !s.focused);
    return { focused, others };
  }

  /**
   * Sincroniza os containers persistentes do modo foco (`#focus-row`
   * e `#focus-secondary-row`) com o estado atual de `streams`,
   * movendo apenas os cards que precisam trocar de grupo/posição.
   *
   * @param {HTMLElement} focusRowEl
   * @param {HTMLElement} secondaryRowEl
   * @param {Array<Object>} streams
   * @param {Map<string, HTMLElement>} cardElements
   */
  function syncFocusContainers(focusRowEl, secondaryRowEl, streams, cardElements) {
    const { focused, others } = splitFocusedStreams(streams);

    window.MSH.layout.syncContainerOrder(
      focusRowEl,
      focused.map((s) => s.id),
      cardElements
    );
    focusRowEl.dataset.count = String(focused.length);

    window.MSH.layout.syncContainerOrder(
      secondaryRowEl,
      others.map((s) => s.id),
      cardElements
    );
  }

  window.MSH.focus = {
    MAX_FOCUS,
    toggleFocus,
    isFocusModeActive,
    splitFocusedStreams,
    syncFocusContainers,
  };
})();