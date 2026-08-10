(function () {
  "use strict";

  const { api, players, layout, focus } = window.MSH;

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
  let idCounter = 0;

  function generateId() {
    idCounter += 1;
    return `stream-${Date.now()}-${idCounter}`;
  }

  const el = {
    streamsArea: document.getElementById("streams-area"),
    addStreamPanel: document.getElementById("add-stream-panel"),
    addStreamForm: document.getElementById("add-stream-form"),
    platformSelect: document.getElementById("platform-select"),
    channelInput: document.getElementById("channel-input"),

    btnAddStream: document.getElementById("btn-add-stream"),
    btnLayout: document.getElementById("btn-layout"),
    btnSettings: document.getElementById("btn-settings"),
    btnTheme: document.getElementById("btn-theme"),
    btnCloseSettings: document.getElementById("btn-close-settings"),
    btnSaveCurrentLayout: document.getElementById("btn-save-current-layout"),

    sidebar: document.getElementById("settings-sidebar"),
    sidebarOverlay: document.getElementById("sidebar-overlay"),
    savedLayoutsList: document.getElementById("saved-layouts-list"),

    settingTheme: document.getElementById("setting-theme"),
    settingQuality: document.getElementById("setting-quality"),
    settingAutoMute: document.getElementById("setting-auto-mute"),
    settingAutoFocus: document.getElementById("setting-auto-focus"),
    settingLanguage: document.getElementById("setting-language"),
    settingAutoSave: document.getElementById("setting-auto-save"),

    toast: document.getElementById("toast"),
  };

  let toastTimeout = null;
  function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.add("is-visible");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      el.toast.classList.remove("is-visible");
    }, 2600);
  }

  function createCard(stream) {
    const card = players.createCardElement(stream);

    card.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      handleCardAction(button.dataset.action, stream.id, card);
    });

    return card;
  }

  function render() {
    const streams = state.streams;

    if (streams.length === 0) {
      focus.exitFocusMode(el.streamsArea);
      el.streamsArea.innerHTML = `
        <div id="streams-grid" class="streams-grid" data-count="0">
          <div class="empty-state" id="empty-state">
            <div class="empty-state__icon">📺</div>
            <div class="empty-state__title">Nenhuma live adicionada ainda</div>
            <p class="text-secondary">
              Clique em "Adicionar Stream" para começar a montar seu multistream.
            </p>
          </div>
        </div>
      `;
      return;
    }

    if (focus.isFocusModeActive(streams)) {
      focus.renderFocusMode(el.streamsArea, streams, createCard);
      return;
    }

    focus.exitFocusMode(el.streamsArea);
    const gridEl = document.createElement("div");
    gridEl.id = "streams-grid";
    gridEl.className = "streams-grid";

    const ordered = layout.sortStreamsForDisplay(streams);
    ordered.forEach((stream) => gridEl.appendChild(createCard(stream)));

    layout.updateGridCount(gridEl, ordered.length);
    el.streamsArea.appendChild(gridEl);

    layout.enableDragAndDrop(gridEl, reorderStreams);
  }

  function persistIfAutoSave() {
    if (state.settings.autoSave) {
      layout.saveLayout(AUTOSAVE_LAYOUT_NAME, state.streams);
    }
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

      const stream = {
        id: generateId(),
        platform: data.platform,
        channel: data.channel,
        embedUrl: data.embed_url,
        muted: state.settings.autoMute,
        pinned: false,
        focused: false,
      };

      state.streams.push(stream);
      render();
      persistIfAutoSave();
      showToast(`${channel} adicionado.`);
    } catch (err) {
      showToast(err.message || "Erro ao adicionar a live.");
    }
  }

  function removeStream(id, cardEl) {
    const finish = () => {
      state.streams = state.streams.filter((s) => s.id !== id);
      render();
      persistIfAutoSave();
    };

    if (cardEl) {
      players.removeCardElement(cardEl, finish);
    } else {
      finish();
    }
  }

  function toggleMute(id) {
    const stream = state.streams.find((s) => s.id === id);
    if (!stream) return;
    stream.muted = !stream.muted;
    render();
    persistIfAutoSave();
  }

  function togglePin(id) {
    const stream = state.streams.find((s) => s.id === id);
    if (!stream) return;
    stream.pinned = !stream.pinned;
    render();
    persistIfAutoSave();
  }

  function toggleFocusOnStream(id) {
    const result = focus.toggleFocus(state.streams, id);
    if (!result.ok) {
      showToast(result.reason);
      return;
    }
    state.streams = result.streams;
    render();
    persistIfAutoSave();
  }

  function reorderStreams(draggedId, targetId) {
    const streams = state.streams;
    const fromIndex = streams.findIndex((s) => s.id === draggedId);
    const toIndex = streams.findIndex((s) => s.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    const [moved] = streams.splice(fromIndex, 1);
    streams.splice(toIndex, 0, moved);

    render();
    persistIfAutoSave();
  }

  function handleCardAction(action, id, cardEl) {
    switch (action) {
      case "remove":
        removeStream(id, cardEl);
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
      case "fullscreen":
        players.requestFullscreen(cardEl);
        break;
      default:
        break;
    }
  }

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
  }

  el.settingQuality.addEventListener("change", (e) => {
    state.settings.quality = e.target.value;
    saveSettings();
    showToast("Qualidade padrão atualizada.");
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

  async function loadNamedLayout(name) {
    const data = layout.getLayout(name);
    if (!data) return;

    state.streams = [];
    render();

    showToast(`Carregando layout "${name}"...`);

    for (const saved of data.streams) {
      try {
        const resolved = await api.resolveChannel(saved.platform, saved.channel);
        state.streams.push({
          id: generateId(),
          platform: resolved.platform,
          channel: resolved.channel,
          embedUrl: resolved.embed_url,
          muted: saved.muted ?? state.settings.autoMute,
          pinned: saved.pinned ?? false,
          focused: false,
        });
      } catch (err) {
        console.warn(`Falha ao carregar ${saved.channel}:`, err);
      }
    }

    render();
    closeSettings();
    showToast(`Layout "${name}" carregado.`);
  }

  async function init() {
    loadSettings();
    applySettingsToUI();

    if (state.settings.autoSave) {
      const autosave = layout.getLayout(AUTOSAVE_LAYOUT_NAME);
      if (autosave && autosave.streams.length > 0) {
        await loadAutosave(autosave);
      }
    }

    render();
  }

  async function loadAutosave(autosave) {
    for (const saved of autosave.streams) {
      try {
        const resolved = await api.resolveChannel(saved.platform, saved.channel);
        state.streams.push({
          id: generateId(),
          platform: resolved.platform,
          channel: resolved.channel,
          embedUrl: resolved.embed_url,
          muted: saved.muted ?? state.settings.autoMute,
          pinned: saved.pinned ?? false,
          focused: false,
        });
      } catch (err) {
        console.warn(`Falha ao restaurar ${saved.channel}:`, err);
      }
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();