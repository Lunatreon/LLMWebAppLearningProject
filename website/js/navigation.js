// FeelY navigation: see website/EDITING.md for file responsibilities and load order.

function openSidebar() {
  sidebar.classList.add("open");
  sidebarBackdrop.classList.remove("hidden");
}

function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarBackdrop.classList.add("hidden");
}

function switchWorkspace(view) {
  const showMap = view === "map";
  const showJournal = view === "journal";
  const returningToChat = !showMap && !showJournal && conversationView.classList.contains("hidden");
  if (showMap) {
    state.activeMapNodeId = null;
    state.mapDetailOpen = false;
  }
  if (!showJournal && state.journalDirty) saveJournalEntry().catch(renderInlineError);
  conversationView.classList.toggle("hidden", showMap || showJournal);
  mapView.classList.toggle("hidden", !showMap);
  journalView.classList.toggle("hidden", !showJournal);
  chatWorkspaceButton.classList.toggle("active", !showMap && !showJournal);
  mapWorkspaceButton.classList.toggle("active", showMap);
  journalWorkspaceButton.classList.toggle("active", showJournal);
  chatSidebarContent.classList.toggle("hidden", showMap || showJournal);
  mapSidebarContent.classList.toggle("hidden", !showMap);
  journalSidebarContent.classList.toggle("hidden", !showJournal);
  chatWorkspaceButton.setAttribute("aria-selected", String(!showMap && !showJournal));
  mapWorkspaceButton.setAttribute("aria-selected", String(showMap));
  journalWorkspaceButton.setAttribute("aria-pressed", String(showJournal));
  chatWorkspaceButton.tabIndex = !showMap ? 0 : -1;
  mapWorkspaceButton.tabIndex = showMap ? 0 : -1;
  journalWorkspaceButton.tabIndex = 0;
  document.title = showMap
    ? "My Map | FeelY"
    : showJournal
      ? "Journal | FeelY"
      : `${chatTitle.textContent} | FeelY`;
  closeSidebar();
  if (showMap) {
    if (hasMyMapAccess()) {
      loadMap().catch(renderInlineError);
    } else {
      renderMap();
    }
  }
  if (showJournal) loadJournalWorkspace().catch(renderInlineError);
  if (returningToChat) startNewChat();
}

