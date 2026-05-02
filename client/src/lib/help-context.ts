const HELP_PANEL_OPEN_EVENT = "help-panel:open";

export function openHelpPanel() {
  document.dispatchEvent(new CustomEvent(HELP_PANEL_OPEN_EVENT));
}

export { HELP_PANEL_OPEN_EVENT };
