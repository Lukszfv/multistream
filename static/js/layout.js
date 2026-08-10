(function () {
  "use strict";

  window.MSH = window.MSH || {};

  const STORAGE_KEY = "msh:saved-layouts";

  function updateGridCount(gridEl, count) {
    gridEl.dataset.count = String(count);
    gridEl.classList.toggle("is-overflow", count > 12);
  }

  /**
   * Ordena a lista de streams para exibição: lives fixadas (pinned)
   * sempre aparecem primeiro, mantendo a ordem relativa dentro de cada
   * grupo (fixadas / não fixadas).
   *
   * @param {Array<Object>} streams
   * @returns {Array<Object>} nova lista ordenada (não modifica a original)
   */
  function sortStreamsForDisplay(streams) {
    const pinned = streams.filter((s) => s.pinned);
    const rest = streams.filter((s) => !s.pinned);
    return [...pinned, ...rest];
  }

  /**
   * Habilita drag and drop dentro de um container de cards. Quando o
   * usuário solta um card sobre outro, `onReorder(draggedId, targetId)`
   * é chamado para que o app.js reordene o estado real.
   *
   * A função é idempotente: pode ser chamada de novo após o grid ser
   * re-renderizado sem duplicar listeners (usamos delegação de evento
   * no container em vez de listeners por card).
   *
   * @param {HTMLElement} containerEl
   * @param {Function} onReorder
   */
  function enableDragAndDrop(containerEl, onReorder) {
    if (containerEl.dataset.dndEnabled === "true") {
      return;
    }
    containerEl.dataset.dndEnabled = "true";

    let draggedId = null;

    containerEl.addEventListener("dragstart", (event) => {
      const card = event.target.closest(".stream-card");
      if (!card) return;
      draggedId = card.dataset.id;
      card.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
    });

    containerEl.addEventListener("dragend", (event) => {
      const card = event.target.closest(".stream-card");
      if (card) card.classList.remove("is-dragging");
      containerEl
        .querySelectorAll(".stream-card.is-drag-over")
        .forEach((el) => el.classList.remove("is-drag-over"));
      draggedId = null;
    });

    containerEl.addEventListener("dragover", (event) => {
      const card = event.target.closest(".stream-card");
      if (!card) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      card.classList.add("is-drag-over");
    });

    containerEl.addEventListener("dragleave", (event) => {
      const card = event.target.closest(".stream-card");
      if (card) card.classList.remove("is-drag-over");
    });

    containerEl.addEventListener("drop", (event) => {
      const card = event.target.closest(".stream-card");
      if (!card) return;
      event.preventDefault();
      card.classList.remove("is-drag-over");

      const targetId = card.dataset.id;
      if (draggedId && targetId && draggedId !== targetId) {
        onReorder(draggedId, targetId);
      }
      draggedId = null;
    });
  }

  /**
   * Lê o dicionário completo de layouts salvos do LocalStorage.
   * Formato: { [nome]: { streams: [...], savedAt: ISOString } }
   */
  function readAllLayouts() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      console.warn("Não foi possível ler layouts salvos:", err);
      return {};
    }
  }

  function writeAllLayouts(layouts) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
    } catch (err) {
      console.warn("Não foi possível salvar layouts:", err);
    }
  }

  function saveLayout(name, streams) {
    const layouts = readAllLayouts();
    layouts[name] = {
      streams: streams.map((s) => ({
        platform: s.platform,
        channel: s.channel,
        pinned: s.pinned,
        muted: s.muted,
      })),
      savedAt: new Date().toISOString(),
    };
    writeAllLayouts(layouts);
  }

  function listLayouts() {
    const layouts = readAllLayouts();
    return Object.entries(layouts)
      .sort((a, b) => new Date(b[1].savedAt) - new Date(a[1].savedAt))
      .map(([name, data]) => ({ name, ...data }));
  }

  function getLayout(name) {
    const layouts = readAllLayouts();
    return layouts[name] || null;
  }

  function deleteLayout(name) {
    const layouts = readAllLayouts();
    delete layouts[name];
    writeAllLayouts(layouts);
  }

  window.MSH.layout = {
    updateGridCount,
    sortStreamsForDisplay,
    enableDragAndDrop,
    saveLayout,
    listLayouts,
    getLayout,
    deleteLayout,
  };
})();