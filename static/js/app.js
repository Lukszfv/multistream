(function () {
  "use strict";

  const { api, players, layout, focus } = window.MSH;

  // -----------------------------------------------------------------
  // ESTADO GLOBAL
  // -----------------------------------------------------------------
  const state = {
    streams: [],
    settings: {
      theme: "dark",
      quality: "auto",
      autoMute: true,
      autoFocus: false,
      language: "pt-BR",
      autoSave: true,
    },
  };

  const SETTINGS_KEY = "msh:settings";
  const AUTOSAVE_LAYOUT_NAME = "__autosave__";

  // -----------------------------------------------------------------
  // GERENCIADOR DE PLAYERS
  // -----------------------------------------------------------------
  // `cardElements` é o coração da correção de performance: mapeia o ID
  // único e estável de cada stream (ex.: "player-1", "player-2") para
  // o NÓ DOM real do seu card. Uma vez criado, um card só é destruído
  // quando a própria stream é removida — nunca por causa de outra
  // stream sendo adicionada/removida/editada/mutada.
  const cardElements = new Map();

  let idCounter = 0;
  function generateId() {
    idCounter += 1;
    return `player-${idCounter}`; // IDs nunca são reaproveitados
  }

  // -----------------------------------------------------------------
  // REFERÊNCIAS DE ELEMENTOS DOM
  // -----------------------------------------------------------------
  const el = {
    streamsArea: document.getElementById("streams-area"),
    emptyState: document.getElementById("empty-state"),
    streamsGrid: document.getElementById("streams-grid"),
    focusRow: document.getElementById("focus-row"),
    focusSecondaryRow: document.getElementById("focus-secondary-row"),

    addStreamPanel: document.getElementById("add-stream-panel"),
    addStreamForm: document.getElementById("add-stream-form"),
    platformSelect: document.getElementById("platform-select"),
    channelInput: document.getElementById("channel-input"),

    btnAddStream: document.getElementById("btn-add-stream"),
    btnLayout: document.getElementById("btn-layout"),
    btnMuteAll: document.getElementById("btn-mute-all"),
    btnSettings: document.getElementById("btn-settings"),
    btnTheme: document.getElementById("btn-theme"),
    btnCloseSettings: document.getElementById("btn-close-settings"),
    btnSaveCurrentLayout: document.getElementById("btn-save-current-layout"),

    sidebar: document.getElementById("settings-sidebar"),
    sidebarOverlay: document.getElementById("sidebar-overlay"),
    savedLayoutsList: document.getElementById("saved-layouts-list"),

    settingTheme: document.getElementById("setting-theme"),
    settingQuality: document.getElementById("setting-quality"),
    qualityNote: document.getElementById("quality-note"),
    settingAutoMute: document.getElementById("setting-auto-mute"),
    settingAutoFocus: document.getElementById("setting-auto-focus"),
    settingLanguage: document.getElementById("setting-language"),
    settingAutoSave: document.getElementById("setting-auto-save"),

    editModalOverlay: document.getElementById("edit-modal-overlay"),
    editStreamForm: document.getElementById("edit-stream-form"),
    editPlatformSelect: document.getElementById("edit-platform-select"),
    editChannelInput: document.getElementById("edit-channel-input"),
    btnCloseEditModal: document.getElementById("btn-close-edit-modal"),
    btnCancelEdit: document.getElementById("btn-cancel-edit"),

    toast: document.getElementById("toast"),
  };

  // -----------------------------------------------------------------
  // TOAST
  // -----------------------------------------------------------------
  let toastTimeout = null;
  function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.add("is-visible");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      el.toast.classList.remove("is-visible");
    }, 2600);
  }

  // -----------------------------------------------------------------
  // CRIAÇÃO DE CARDS (uma única vez por stream)
  // -----------------------------------------------------------------
  function createCard(stream) {
    const card = players.createCardElement(stream);
    card.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      handleCardAction(button.dataset.action, stream.id, card);
    });
    cardElements.set(stream.id, card);
    return card;
  }

  function getOrCreateCardElement(stream) {
    return cardElements.get(stream.id) || createCard(stream);
  }

  // -----------------------------------------------------------------
  // SINCRONIZAÇÃO DE TELA (substitui o antigo render() que recriava
  // tudo). Em vez de reconstruir o DOM inteiro a cada mudança, esta
  // função:
  //   1. Garante que exista um card para cada stream (só cria os que
  //      ainda não existem — os já existentes não são tocados aqui).
  //   2. Alterna quais dos 4 containers persistentes ficam visíveis
  //      (vazio / grid / foco), sem recriar nenhum deles.
  //   3. Move os cards para o container/posição corretos usando
  //      layout.syncContainerOrder, que só mexe em quem realmente
  //      mudou de lugar.
  // -----------------------------------------------------------------
  function syncView() {
    const streams = state.streams;

    if (streams.length === 0) {
      el.emptyState.classList.remove("is-hidden");
      el.streamsGrid.classList.add("is-hidden");
      el.focusRow.classList.add("is-hidden");
      el.focusSecondaryRow.classList.add("is-hidden");
      el.streamsArea.classList.remove("is-focus-mode");
      return;
    }

    el.emptyState.classList.add("is-hidden");
    streams.forEach((stream) => getOrCreateCardElement(stream));

    if (focus.isFocusModeActive(streams)) {
      el.streamsGrid.classList.add("is-hidden");
      el.focusRow.classList.remove("is-hidden");
      el.focusSecondaryRow.classList.remove("is-hidden");
      el.streamsArea.classList.add("is-focus-mode");

      focus.syncFocusContainers(el.focusRow, el.focusSecondaryRow, streams, cardElements);
    } else {
      el.focusRow.classList.add("is-hidden");
      el.focusSecondaryRow.classList.add("is-hidden");
      el.streamsArea.classList.remove("is-focus-mode");
      el.streamsGrid.classList.remove("is-hidden");

      const ordered = layout.sortStreamsForDisplay(streams);
      layout.updateGridCount(el.streamsGrid, ordered.length);
      layout.syncContainerOrder(el.streamsGrid, ordered.map((s) => s.id), cardElements);
      layout.enableDragAndDrop(el.streamsGrid, reorderStreams);
    }

    updateMuteAllButtonUI();
  }

  function persistIfAutoSave() {
    if (state.settings.autoSave) {
      layout.saveLayout(AUTOSAVE_LAYOUT_NAME, state.streams);
    }
  }

  // -----------------------------------------------------------------
  // AÇÕES SOBRE STREAMS
  // -----------------------------------------------------------------

  /** Constrói o objeto de estado de uma stream a partir da resposta da API. */
  function buildStreamFromApiResponse(data, extra) {
    return {
      id: generateId(),
      platform: data.platform,
      channel: data.channel,
      embedUrl: data.embed_url,
      isLive: !!data.is_live,
      found: data.found !== false,
      statusMessage: data.message || null,
      muted: state.settings.autoMute,
      pinned: false,
      focused: false,
      quality: state.settings.quality,
      ...extra,
    };
  }

  async function addStream(platform, channelRaw) {
    const channel = channelRaw.trim();
    if (!channel) return;

    const alreadyExists = state.streams.some(
      (s) => s.platform === platform && s.channel.toLowerCase() === channel.toLowerCase()
    );
    if (alreadyExists) {
      showToast("Essa live já foi adicionada.");
      return;
    }

    try {
      const data = await api.resolveChannel(platform, channel);
      const stream = buildStreamFromApiResponse(data);

      // Só cria o player NOVO — nenhum outro card é tocado.
      state.streams.push(stream);
      syncView();
      persistIfAutoSave();

      if (stream.isLive) {
        showToast(`${stream.channel} adicionado.`);
      } else {
        showToast(stream.statusMessage || "Canal adicionado, mas não está ao vivo no momento.");
      }
    } catch (err) {
      showToast(err.message || "Erro ao adicionar a live.");
    }
  }

  function removeStream(id) {
    const cardEl = cardElements.get(id);

    const finish = () => {
      cardElements.delete(id);
      state.streams = state.streams.filter((s) => s.id !== id);
      // O grid se reorganiza sozinho via CSS Grid/Flex; os players
      // restantes nunca são recriados.
      syncView();
      persistIfAutoSave();
    };

    if (cardEl) {
      players.removeCardElement(cardEl, finish); // remove só ESTE card
    } else {
      finish();
    }
  }

  function toggleMute(id) {
    const stream = state.streams.find((s) => s.id === id);
    if (!stream) return;
    stream.muted = !stream.muted;

    const cardEl = cardElements.get(id);
    if (cardEl) {
      players.refreshPlayerBody(cardEl, stream); // recarrega só este iframe
      players.applyStateClasses(cardEl, stream);
    }
    persistIfAutoSave();
    updateMuteAllButtonUI();
  }

  function togglePin(id) {
    const stream = state.streams.find((s) => s.id === id);
    if (!stream) return;
    stream.pinned = !stream.pinned;

    const cardEl = cardElements.get(id);
    if (cardEl) players.applyStateClasses(cardEl, stream);

    syncView(); // pode reposicionar o card, mas não recria nenhum iframe
    persistIfAutoSave();
  }

  function toggleFocusOnStream(id) {
    const result = focus.toggleFocus(state.streams, id);
    if (!result.ok) {
      showToast(result.reason);
      return;
    }
    state.streams = result.streams;

    const updatedStream = state.streams.find((s) => s.id === id);
    const cardEl = cardElements.get(id);
    if (cardEl && updatedStream) players.applyStateClasses(cardEl, updatedStream);

    syncView();
    persistIfAutoSave();
  }

  function reorderStreams(draggedId, targetId) {
    const streams = state.streams;
    const fromIndex = streams.findIndex((s) => s.id === draggedId);
    const toIndex = streams.findIndex((s) => s.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    const [moved] = streams.splice(fromIndex, 1);
    streams.splice(toIndex, 0, moved);

    syncView(); // só move quem de fato trocou de posição
    persistIfAutoSave();
  }

  /** Verifica novamente uma stream específica (ex.: canal estava offline). */
  async function retryStream(id) {
    const stream = state.streams.find((s) => s.id === id);
    if (!stream) return;

    try {
      const data = await api.resolveChannel(stream.platform, stream.channel);
      stream.embedUrl = data.embed_url;
      stream.isLive = !!data.is_live;
      stream.found = data.found !== false;
      stream.statusMessage = data.message || null;

      const cardEl = cardElements.get(id);
      if (cardEl) players.refreshPlayerBody(cardEl, stream);
      persistIfAutoSave();
    } catch (err) {
      showToast(err.message || "Erro ao verificar a stream.");
    }
  }

  function handleCardAction(action, id, cardEl) {
    switch (action) {
      case "remove":
        removeStream(id);
        break;
      case "mute":
        toggleMute(id);
        break;
      case "pin":
        togglePin(id);
        break;
      case "focus":
        toggleFocusOnStream(id);
        break;
      case "chat":
        players.toggleChatPanel(cardEl);
        break;
      case "edit":
        openEditModal(id);
        break;
      case "fullscreen":
        players.requestFullscreen(cardEl);
        break;
      case "retry":
        retryStream(id);
        break;
      default:
        break;
    }
  }

  // -----------------------------------------------------------------
  // EDITAR STREAM (modal)
  // -----------------------------------------------------------------
  let editingStreamId = null;

  function openEditModal(id) {
    const stream = state.streams.find((s) => s.id === id);
    if (!stream) return;

    editingStreamId = id;
    el.editPlatformSelect.value = stream.platform;
    el.editChannelInput.value = stream.channel;
    el.editModalOverlay.classList.remove("is-hidden");
    el.editChannelInput.focus();
  }

  function closeEditModal() {
    el.editModalOverlay.classList.add("is-hidden");
    editingStreamId = null;
  }

  el.btnCloseEditModal.addEventListener("click", closeEditModal);
  el.btnCancelEdit.addEventListener("click", closeEditModal);
  el.editModalOverlay.addEventListener("click", (event) => {
    if (event.target === el.editModalOverlay) closeEditModal();
  });

  el.editStreamForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!editingStreamId) return;

    const stream = state.streams.find((s) => s.id === editingStreamId);
    if (!stream) return;

    const newPlatform = el.editPlatformSelect.value;
    const newChannel = el.editChannelInput.value.trim();
    if (!newChannel) return;

    try {
      const data = await api.resolveChannel(newPlatform, newChannel);

      // Atualiza SOMENTE esta stream — id, posição, pin, foco e mute
      // permanecem exatamente como estavam.
      stream.platform = data.platform;
      stream.channel = data.channel;
      stream.embedUrl = data.embed_url;
      stream.isLive = !!data.is_live;
      stream.found = data.found !== false;
      stream.statusMessage = data.message || null;

      const cardEl = cardElements.get(stream.id);
      if (cardEl) {
        players.updateCardHeader(cardEl, stream); // nome/badge deste card
        players.refreshPlayerBody(cardEl, stream); // player deste card
      }

      persistIfAutoSave();
      closeEditModal();
      showToast("Stream atualizada.");
    } catch (err) {
      showToast(err.message || "Erro ao atualizar a stream.");
    }
  });

  // -----------------------------------------------------------------
  // FORMULÁRIO "ADICIONAR STREAM"
  // -----------------------------------------------------------------
  el.btnAddStream.addEventListener("click", () => {
    el.addStreamPanel.classList.toggle("is-hidden");
    if (!el.addStreamPanel.classList.contains("is-hidden")) {
      el.channelInput.focus();
    }
  });

  el.addStreamForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const platform = el.platformSelect.value;
    const channel = el.channelInput.value;
    addStream(platform, channel);
    el.channelInput.value = "";
  });

  // -----------------------------------------------------------------
  // MUTE GLOBAL ("acima das streams")
  // -----------------------------------------------------------------
  // Um único botão que funciona como um alternador inteligente:
  //   - se existe pelo menos uma stream desmutada -> muta todas
  //     (equivalente ao "Modo 1: mutar todas")
  //   - se todas já estão mutadas -> desmuta todas
  //     (equivalente ao "Modo 2: desmutar todas")
  // O clique sempre alterna entre esses dois estados de conjunto
  // ("Modo 3: alternar"), e o ícone reflete o estado atual.
  function updateMuteAllButtonUI() {
    if (state.streams.length === 0) {
      el.btnMuteAll.textContent = "🔊";
      el.btnMuteAll.setAttribute("aria-pressed", "false");
      el.btnMuteAll.classList.remove("is-active");
      return;
    }
    const allMuted = state.streams.every((s) => s.muted);
    el.btnMuteAll.textContent = allMuted ? "🔇" : "🔊";
    el.btnMuteAll.setAttribute("aria-pressed", String(allMuted));
    el.btnMuteAll.classList.toggle("is-active", allMuted);
  }

  el.btnMuteAll.addEventListener("click", () => {
    if (state.streams.length === 0) return;

    const allMuted = state.streams.every((s) => s.muted);
    const nextMuted = !allMuted;

    state.streams.forEach((stream) => {
      stream.muted = nextMuted;
      const cardEl = cardElements.get(stream.id);
      if (cardEl) {
        players.refreshPlayerBody(cardEl, stream);
        players.applyStateClasses(cardEl, stream);
      }
    });

    updateMuteAllButtonUI();
    persistIfAutoSave();
    showToast(nextMuted ? "Todas as streams foram mutadas." : "Todas as streams foram desmutadas.");
  });

  // -----------------------------------------------------------------
  // TEMA
  // -----------------------------------------------------------------
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    state.settings.theme = theme;
    el.settingTheme.value = theme;
    el.btnTheme.textContent = theme === "blue" ? "🔵" : "🌙";
    saveSettings();
  }

  el.btnTheme.addEventListener("click", () => {
    const next = state.settings.theme === "dark" ? "blue" : "dark";
    applyTheme(next);
  });

  el.settingTheme.addEventListener("change", (e) => applyTheme(e.target.value));

  // -----------------------------------------------------------------
  // SIDEBAR DE CONFIGURAÇÕES
  // -----------------------------------------------------------------
  function openSettings() {
    el.sidebar.classList.add("is-open");
    el.sidebarOverlay.classList.add("is-open");
    renderSavedLayoutsList();
  }

  function closeSettings() {
    el.sidebar.classList.remove("is-open");
    el.sidebarOverlay.classList.remove("is-open");
  }

  el.btnSettings.addEventListener("click", openSettings);
  el.btnLayout.addEventListener("click", openSettings);
  el.btnCloseSettings.addEventListener("click", closeSettings);
  el.sidebarOverlay.addEventListener("click", closeSettings);

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    } catch (err) {
      console.warn("Não foi possível salvar as configurações:", err);
    }
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      Object.assign(state.settings, JSON.parse(raw));
    } catch (err) {
      console.warn("Não foi possível carregar as configurações:", err);
    }
  }

  function applySettingsToUI() {
    el.settingTheme.value = state.settings.theme;
    el.settingQuality.value = state.settings.quality;
    el.settingAutoMute.checked = state.settings.autoMute;
    el.settingAutoFocus.checked = state.settings.autoFocus;
    el.settingLanguage.value = state.settings.language;
    el.settingAutoSave.checked = state.settings.autoSave;
    document.documentElement.setAttribute("data-theme", state.settings.theme);
    el.btnTheme.textContent = state.settings.theme === "blue" ? "🔵" : "🌙";
    updateQualityNote();
  }

  // -----------------------------------------------------------------
  // QUALIDADE PADRÃO
  // -----------------------------------------------------------------
  // A qualidade escolhida é salva no LocalStorage (via saveSettings)
  // e aplicada a toda NOVA stream adicionada depois da escolha (não é
  // possível "empurrar" qualidade retroativamente para um iframe já
  // carregado sem recarregá-lo, então streams existentes não mudam).
  function updateQualityNote() {
    if (!el.qualityNote) return;
    el.qualityNote.textContent =
      "Aplicada apenas a novas streams. A Twitch e o Kick não expõem controle de " +
      "qualidade via <iframe> simples (exigiria o SDK oficial de cada plataforma). " +
      "No YouTube o parâmetro é legado e pode ser ignorado pelo player.";
  }

  el.settingQuality.addEventListener("change", (e) => {
    state.settings.quality = e.target.value;
    saveSettings();
    showToast("Qualidade padrão atualizada para novas streams.");
  });

  el.settingAutoMute.addEventListener("change", (e) => {
    state.settings.autoMute = e.target.checked;
    saveSettings();
  });

  el.settingAutoFocus.addEventListener("change", (e) => {
    state.settings.autoFocus = e.target.checked;
    saveSettings();
  });

  el.settingLanguage.addEventListener("change", (e) => {
    state.settings.language = e.target.value;
    saveSettings();
  });

  el.settingAutoSave.addEventListener("change", (e) => {
    state.settings.autoSave = e.target.checked;
    saveSettings();
    if (state.settings.autoSave) persistIfAutoSave();
  });

  // -----------------------------------------------------------------
  // LAYOUTS SALVOS
  // -----------------------------------------------------------------
  function renderSavedLayoutsList() {
    const layouts = layout.listLayouts().filter((l) => l.name !== AUTOSAVE_LAYOUT_NAME);

    if (layouts.length === 0) {
      el.savedLayoutsList.innerHTML = `<p class="text-secondary" style="font-size: var(--font-size-sm);">
        Nenhum layout salvo ainda.
      </p>`;
      return;
    }

    el.savedLayoutsList.innerHTML = "";
    layouts.forEach(({ name }) => {
      const item = document.createElement("div");
      item.className = "saved-layout-item";
      item.innerHTML = `
        <span>${name}</span>
        <div class="saved-layout-item__actions">
          <button class="btn btn--sm" data-load="${name}">Carregar</button>
          <button class="btn btn--sm btn--danger" data-delete="${name}">Excluir</button>
        </div>
      `;
      el.savedLayoutsList.appendChild(item);
    });
  }

  el.savedLayoutsList.addEventListener("click", async (event) => {
    const loadBtn = event.target.closest("[data-load]");
    const deleteBtn = event.target.closest("[data-delete]");

    if (loadBtn) {
      await loadNamedLayout(loadBtn.dataset.load);
    } else if (deleteBtn) {
      layout.deleteLayout(deleteBtn.dataset.delete);
      renderSavedLayoutsList();
      showToast("Layout excluído.");
    }
  });

  el.btnSaveCurrentLayout.addEventListener("click", () => {
    if (state.streams.length === 0) {
      showToast("Adicione ao menos uma live antes de salvar um layout.");
      return;
    }
    const name = window.prompt(
      "Nome do layout (ex: Campeonato, Duo, Quad Grid, Esports, Custom):"
    );
    if (!name) return;
    layout.saveLayout(name.trim(), state.streams);
    renderSavedLayoutsList();
    showToast(`Layout "${name.trim()}" salvo.`);
  });

  /** Remove todos os cards atuais do DOM e zera o estado de streams. */
  function clearAllStreams() {
    cardElements.forEach((cardEl) => cardEl.remove());
    cardElements.clear();
    state.streams = [];
  }

  /** Carrega um layout salvo, refazendo a resolução de cada canal via API. */
  async function loadNamedLayout(name) {
    const data = layout.getLayout(name);
    if (!data) return;

    clearAllStreams();
    syncView();

    showToast(`Carregando layout "${name}"...`);

    for (const saved of data.streams) {
      try {
        const resolved = await api.resolveChannel(saved.platform, saved.channel);
        const stream = buildStreamFromApiResponse(resolved, {
          muted: saved.muted ?? state.settings.autoMute,
          pinned: saved.pinned ?? false,
        });
        state.streams.push(stream);
      } catch (err) {
        console.warn(`Falha ao carregar ${saved.channel}:`, err);
      }
    }

    syncView();
    closeSettings();
    showToast(`Layout "${name}" carregado.`);
  }

  // -----------------------------------------------------------------
  // INICIALIZAÇÃO
  // -----------------------------------------------------------------
  async function init() {
    loadSettings();
    applySettingsToUI();

    if (state.settings.autoSave) {
      const autosave = layout.getLayout(AUTOSAVE_LAYOUT_NAME);
      if (autosave && autosave.streams.length > 0) {
        await loadAutosave(autosave);
      }
    }

    syncView();
  }

  async function loadAutosave(autosave) {
    for (const saved of autosave.streams) {
      try {
        const resolved = await api.resolveChannel(saved.platform, saved.channel);
        const stream = buildStreamFromApiResponse(resolved, {
          muted: saved.muted ?? state.settings.autoMute,
          pinned: saved.pinned ?? false,
        });
        state.streams.push(stream);
      } catch (err) {
        console.warn(`Falha ao restaurar ${saved.channel}:`, err);
      }
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();