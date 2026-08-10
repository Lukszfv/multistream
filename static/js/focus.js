/**
 * MultiStream Hub — focus.js
 * ---------------------------------------------------------------------
 * Módulo responsável pelo "Sistema de Foco", o recurso principal do
 * produto: o usuário pode escolher até 4 lives prioritárias, que
 * passam a ocupar a parte superior da tela em tamanho grande, enquanto
 * as demais lives continuam visíveis, porém reduzidas, logo abaixo.
 *
 * Este módulo não guarda o estado "fonte da verdade" (isso é
 * responsabilidade do app.js), mas oferece funções puras para:
 *   - alternar o foco de uma live respeitando o limite de 4
 *   - separar streams em "focadas" / "demais"
 *   - construir o DOM do modo foco
 *
 * Exposto globalmente como `window.MSH.focus`.
 */

(function () {
  "use strict";

  window.MSH = window.MSH || {};

  const MAX_FOCUS = 4;

  /**
   * Alterna o estado de foco de uma live dentro da lista de streams.
   * Não modifica o array original — retorna um novo array.
   *
   * @param {Array<Object>} streams
   * @param {string} streamId
   * @returns {{ streams: Array<Object>, ok: boolean, reason?: string }}
   */
  function toggleFocus(streams, streamId) {
    const target = streams.find((s) => s.id === streamId);
    if (!target) {
      return { streams, ok: false, reason: "Live não encontrada." };
    }

    const currentlyFocusedCount = streams.filter((s) => s.focused).length;

    // Se já está focada, apenas remove do foco (sempre permitido).
    if (target.focused) {
      const updated = streams.map((s) =>
        s.id === streamId ? { ...s, focused: false } : s
      );
      return { streams: updated, ok: true };
    }

    // Se não está focada, só permite adicionar se ainda houver "vaga".
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

  /** Retorna true se há pelo menos uma live em modo foco. */
  function isFocusModeActive(streams) {
    return streams.some((s) => s.focused);
  }

  /**
   * Separa a lista de streams em dois grupos preservando a ordem
   * original: as focadas (no máximo MAX_FOCUS) e as demais.
   */
  function splitFocusedStreams(streams) {
    const focused = streams.filter((s) => s.focused);
    const others = streams.filter((s) => !s.focused);
    return { focused, others };
  }

  /**
   * Constrói (ou atualiza) o DOM do modo foco dentro do container
   * `.streams-area`. Recebe uma função `createCardFn(stream)` (vinda
   * de players.js) para não duplicar lógica de criação de cards.
   *
   * Estrutura gerada:
   *   <div class="streams-area is-focus-mode">
   *     <div class="focus-row" data-count="N">  -- lives focadas, grandes
   *     <div class="focus-secondary-row">        -- demais lives, reduzidas
   *
   * @param {HTMLElement} areaEl - elemento com classe "streams-area"
   * @param {Array<Object>} streams
   * @param {Function} createCardFn
   */
  function renderFocusMode(areaEl, streams, createCardFn) {
    const { focused, others } = splitFocusedStreams(streams);

    areaEl.classList.add("is-focus-mode");
    areaEl.innerHTML = "";

    const focusRow = document.createElement("div");
    focusRow.className = "focus-row";
    focusRow.dataset.count = String(focused.length);
    focused.forEach((stream) => {
      focusRow.appendChild(createCardFn(stream));
    });

    const secondaryRow = document.createElement("div");
    secondaryRow.className = "focus-secondary-row";
    others.forEach((stream) => {
      secondaryRow.appendChild(createCardFn(stream));
    });

    areaEl.appendChild(focusRow);
    if (others.length > 0) {
      areaEl.appendChild(secondaryRow);
    }
  }

  /**
   * Remove a estrutura do modo foco, restaurando o container para o
   * estado esperado pelo grid normal (usado pelo layout.js). O app.js
   * é responsável por recriar o `.streams-grid` dentro do container em
   * seguida — este método só limpa.
   */
  function exitFocusMode(areaEl) {
    areaEl.classList.remove("is-focus-mode");
    areaEl.innerHTML = "";
  }

  window.MSH.focus = {
    MAX_FOCUS,
    toggleFocus,
    isFocusModeActive,
    splitFocusedStreams,
    renderFocusMode,
    exitFocusMode,
  };
})();
